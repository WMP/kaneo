import { createHmac, generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";

export const GITHUB_WEBHOOK_SECRET = "whsec_coverage_test_secret";
export const INSTALLATION_TOKEN = "ghs_coverage_installation_token";

// A throw-away key, generated per test file; never a real credential.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
export const GITHUB_PRIVATE_KEY_PEM = privateKey;

export function configureGithubApp() {
  process.env.GITHUB_APP_ID = "424242";
  process.env.GITHUB_WEBHOOK_SECRET = GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_PRIVATE_KEY = GITHUB_PRIVATE_KEY_PEM;
  delete process.env.GITHUB_PRIVATE_KEY_BASE64;
}

export function sign(body: string, secret = GITHUB_WEBHOOK_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export type GithubCall = {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
  search: string;
};

type ReplyBody = { status?: number; body?: unknown };
type Reply = ReplyBody | ((call: GithubCall) => ReplyBody);
export type GithubRoutes = Record<string, Reply>;

/**
 * Stubs the global fetch used by Octokit. Requests that are not listed in
 * `routes` (key: "METHOD /path") answer 404 and are still recorded, so tests
 * can assert the exact set of calls that reached GitHub.
 */
export function stubGithub(routes: GithubRoutes = {}) {
  const calls: GithubCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input));
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? request?.headers);
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : request
            ? await request.text()
            : "";
      const path = decodeURIComponent(url.pathname);
      if (url.origin !== "https://api.github.com") {
        throw new Error(`Unexpected outbound request to ${url.origin}`);
      }
      const isTokenRequest = /^\/app\/installations\/\d+\/access_tokens$/.test(
        path,
      );
      const call: GithubCall = {
        method,
        path,
        body: rawBody ? JSON.parse(rawBody) : null,
        authorization: headers.get("authorization"),
        search: url.search,
      };
      if (!isTokenRequest) calls.push(call);
      const configured: Reply | undefined = isTokenRequest
        ? {
            status: 201,
            body: {
              token: INSTALLATION_TOKEN,
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
              permissions: {},
              repository_selection: "all",
            },
          }
        : routes[`${method} ${path}`];
      const reply =
        typeof configured === "function" ? configured(call) : configured;
      const status = reply?.status ?? (reply ? 200 : 404);
      return new Response(
        JSON.stringify(reply?.body ?? { message: "Not Found" }),
        { status, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return calls;
}
