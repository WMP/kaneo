#!/usr/bin/env node
// Rehearses a public deployment on this machine, so that the screenshots show
// the addresses a real demo instance would: https://kaneopro.example.com and
// not localhost. The MCP page, for example, builds its URL from the API URL the
// web app was built with and from the address of the page.
//
// What it does:
//   1. creates a self-signed certificate for the host in a temporary directory;
//   2. starts an HTTPS reverse proxy: /api (including WebSocket upgrades) goes
//      to the API, everything else (including Vite's HMR socket) to the web app;
//   3. seeds the demo data (the API is called directly, with the public Origin);
//   4. starts Chromium with the host mapped to the proxy and captures the
//      screenshots through https://<host>.
//
// The API and the web app must already run, configured for the host. Put the
// addresses in the two git-ignored files, because `pnpm dev` (turbo) hands only
// some variables on to the apps, while the files work however they are started.
// (apps/web/.env.local would not do: Vite ranks the tracked .env.development
// above it, and only .env.development.local ranks higher.)
//
//   .env                             KANEO_CLIENT_URL=https://kaneopro.example.com
//                                    KANEO_API_URL=https://kaneopro.example.com
//   apps/web/.env.development.local  VITE_API_URL=https://kaneopro.example.com/api
//                                    VITE_CLIENT_URL=https://kaneopro.example.com
//
// The host name needs no DNS entry and no hosts file: Chromium maps it with
// --host-resolver-rules, and the proxy listens on an unprivileged port because
// that rule can also change the port.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { captureScreenshots, DEFAULT_OUT } from "./capture.mjs";
import { seedDemo } from "./seed.mjs";

export const DEFAULT_HOST = "kaneopro.example.com";

// A self-signed certificate that is valid for `host`.
export function createCertificate(directory, host) {
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "2",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `openssl could not create the certificate: ${result.stderr || result.error?.message}`,
    );
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const isApiPath = (url) =>
  url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");

// The HTTPS reverse proxy. The web app is reached as 127.0.0.1 (the Host header
// is rewritten, because Vite only answers local host names); the API sees the
// original Host and Origin.
export function startProxy({ key, cert, listenPort, apiPort, webPort }) {
  const api = { host: "127.0.0.1", port: apiPort, rewriteHost: false };
  const web = { host: "127.0.0.1", port: webPort, rewriteHost: true };
  const pick = (url) => (isApiPath(url) ? api : web);

  const server = https.createServer({ key, cert }, (req, res) => {
    const target = pick(req.url);
    const headers = {
      ...req.headers,
      "x-forwarded-proto": "https",
      "x-forwarded-host": req.headers.host,
    };
    if (target.rewriteHost) headers.host = `${target.host}:${target.port}`;
    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent)
        res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Bad gateway: ${error.message}`);
    });
    req.pipe(upstream);
  });

  // WebSocket upgrades: replay the request on a TCP connection and pipe both ways.
  server.on("upgrade", (req, socket, head) => {
    const target = pick(req.url);
    const upstream = net.connect(target.port, target.host, () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const name = req.rawHeaders[index];
        const value =
          target.rewriteHost && name.toLowerCase() === "host"
            ? `${target.host}:${target.port}`
            : req.rawHeaders[index + 1];
        raw += `${name}: ${value}\r\n`;
      }
      upstream.write(`${raw}\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(listenPort, "127.0.0.1", () => done(server));
  });
}

async function getText(url, init) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    return { response, text: await response.text() };
  } catch (error) {
    return { error };
  }
}

// What to set, and where, for the app to run behind `origin`.
export function setupHint(origin) {
  return [
    "Set these, then restart the API and the web app:",
    `  .env                             KANEO_CLIENT_URL=${origin}`,
    `                                   KANEO_API_URL=${origin}`,
    `  apps/web/.env.development.local  VITE_API_URL=${origin}/api`,
    `                                   VITE_CLIENT_URL=${origin}`,
  ].join("\n");
}

// Vite's dev server starts every module with the environment the web app was
// started with: `import.meta.env = {...};`. Null when the page is not served by
// the dev server.
export function readViteEnv(source) {
  const match = /import\.meta\.env = (\{.*?\});/s.exec(source ?? "");
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Fails early, saying what to change, when the app is not set up for `host`.
export async function checkApp({ host, apiPort, webPort }) {
  const origin = `https://${host}`;
  const start = setupHint(origin);
  const health = await getText(`http://127.0.0.1:${apiPort}/api/health`);
  if (health.error || !health.response.ok) {
    throw new Error(`The API is not running on port ${apiPort}.\n${start}`);
  }
  const preflight = await getText(`http://127.0.0.1:${apiPort}/api/config`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
  });
  if (
    preflight.response?.headers.get("access-control-allow-origin") !== origin
  ) {
    throw new Error(
      `The API does not trust ${origin} (CORS and Better Auth use KANEO_CLIENT_URL).\n${start}`,
    );
  }
  const web = await getText(`http://127.0.0.1:${webPort}/`);
  if (web.error || !web.response.ok) {
    throw new Error(`The web app is not running on port ${webPort}.\n${start}`);
  }
  // The dev server shows the environment the web app was started with.
  const module = await getText(
    `http://127.0.0.1:${webPort}/src/fetchers/get-api-url.ts`,
  );
  const env = readViteEnv(module.text);
  if (
    env &&
    (env.VITE_API_URL !== `${origin}/api` || env.VITE_CLIENT_URL !== origin)
  ) {
    throw new Error(
      `The web app was not started for ${origin}: it runs with VITE_API_URL=${env.VITE_API_URL} and VITE_CLIENT_URL=${env.VITE_CLIENT_URL}.\n${start}`,
    );
  }
}

export function chromiumArgsFor({ host, listenPort }) {
  return [
    `--host-resolver-rules=MAP ${host} 127.0.0.1:${listenPort}`,
    // No HTTP proxy from the environment for the mapped host.
    "--no-proxy-server",
  ];
}

const HELP = `Rehearse a public deployment: HTTPS proxy, demo data, screenshots.

Usage: node scripts/demo/public-host.mjs [options]

  --host <name>        public host name (default ${DEFAULT_HOST})
  --https-port <port>  port of the local HTTPS proxy (default 8443)
  --api-port <port>    port of the running API (default 1337)
  --web-port <port>    port of the running web app (default 5173)
  --anchor <date>      Monday all dates are counted from (default: this week's)
  --only <list>        scene ids, e.g. 01,05 (default: all)
  --out <dir>          screenshot directory (default docs/images/kaneo-pro)
  --video <dir>        also record a webm per scene (not committed)
  --chromium <path>    Chromium executable (or KANEO_DEMO_CHROMIUM)
  --ids-out <file>     keep the ids of the seeded data
  --no-seed            capture what is there; needs --ids <file> of an earlier seed
  --ids <file>         ids of an earlier seed (with --no-seed)
  --serve              keep the proxy running afterwards, for browsing by hand
  --help

Start the app first, configured for the host (see README.md):
  .env                             KANEO_CLIENT_URL=https://${DEFAULT_HOST}
                                   KANEO_API_URL=https://${DEFAULT_HOST}
  apps/web/.env.development.local  VITE_API_URL=https://${DEFAULT_HOST}/api
                                   VITE_CLIENT_URL=https://${DEFAULT_HOST}
`;

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string", default: DEFAULT_HOST },
      "https-port": { type: "string", default: "8443" },
      "api-port": { type: "string", default: "1337" },
      "web-port": { type: "string", default: "5173" },
      anchor: { type: "string" },
      only: { type: "string" },
      out: { type: "string" },
      video: { type: "string" },
      chromium: { type: "string" },
      "ids-out": { type: "string" },
      ids: { type: "string" },
      "no-seed": { type: "boolean" },
      serve: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const host = values.host;
  const listenPort = Number(values["https-port"]);
  const apiPort = Number(values["api-port"]);
  const webPort = Number(values["web-port"]);
  const log = (line) => console.log(line);

  await checkApp({ host, apiPort, webPort });

  const directory = mkdtempSync(join(tmpdir(), "kaneo-public-host-"));
  let proxy;
  try {
    const { key, cert } = createCertificate(directory, host);
    proxy = await startProxy({ key, cert, listenPort, apiPort, webPort });
    log(`HTTPS proxy for https://${host} on 127.0.0.1:${listenPort}`);

    let ids;
    if (values["no-seed"]) {
      if (!values.ids) throw new Error("--no-seed needs --ids <file>");
      ids = JSON.parse(readFileSync(resolve(values.ids), "utf8"));
    } else {
      ids = await seedDemo({
        apiUrl: `http://127.0.0.1:${apiPort}`,
        origin: `https://${host}`,
        anchor: values.anchor,
        reset: true,
        log,
      });
      const idsFile = resolve(values["ids-out"] ?? join(directory, "ids.json"));
      mkdirSync(join(idsFile, ".."), { recursive: true });
      writeFileSync(idsFile, `${JSON.stringify(ids, null, 2)}\n`);
      if (values["ids-out"]) log(`Wrote ${idsFile}`);
    }

    const results = await captureScreenshots({
      webUrl: `https://${host}`,
      ids,
      outDir: values.out ?? DEFAULT_OUT,
      only: values.only?.split(",").map((id) => id.trim()),
      videoDir: values.video,
      chromium: values.chromium ?? process.env.KANEO_DEMO_CHROMIUM,
      launchArgs: chromiumArgsFor({ host, listenPort }),
      ignoreHTTPSErrors: true,
      forbidLocalhost: true,
      log,
    });
    log(`Captured ${results.length} screenshots through https://${host}.`);

    if (values.serve) {
      log(
        `\nServing https://${host}. Open it in a browser started with:\n  chromium --host-resolver-rules="MAP ${host} 127.0.0.1:${listenPort}" --ignore-certificate-errors --no-proxy-server https://${host}\nPress Ctrl+C to stop.`,
      );
      await new Promise((done) => process.once("SIGINT", done));
    }
  } finally {
    proxy?.close();
    proxy?.closeAllConnections?.();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
