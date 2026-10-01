// A small HTTP client for the Kaneo API: a cookie jar (one per signed-in user),
// JSON in and out, the Origin header Better Auth checks, retries for rate
// limits, and an optional guard that sees every request before it is sent.

import { setTimeout as sleep } from "node:timers/promises";

export class ApiError extends Error {
  constructor(message, { status, method, path, data }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.data = data;
    this.code = data && typeof data === "object" ? data.code : undefined;
  }
}

const MAX_RATE_LIMIT_RETRIES = 6;

export class ApiClient {
  // guard(method, path, { query, body }) runs before every request and may
  // throw to refuse it.
  constructor({ baseUrl, origin, guard, label, timeoutMs = 30_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.origin = origin;
    this.guard = guard;
    this.label = label ?? "anonymous";
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
  }

  get cookie() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  #remember(response) {
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const pair = header.split(";")[0];
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  // Returns { status, ok, data }. Statuses in `allow` do not throw.
  async request(method, path, { body, query, allow = [] } = {}) {
    this.guard?.(method, path, { query, body });
    const search = query ? `?${new URLSearchParams(query)}` : "";
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(`${this.baseUrl}${path}${search}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Origin: this.origin,
            ...(this.cookies.size > 0 ? { Cookie: this.cookie } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        if (method === "GET" && attempt < 2) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(
          `${method} ${this.baseUrl}${path} failed: ${error.cause?.code ?? error.message}`,
          { cause: error },
        );
      }
      this.#remember(response);
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const header =
          response.headers.get("x-retry-after") ??
          response.headers.get("retry-after");
        const seconds = Math.min(Math.max(Number(header) || 5, 1), 70);
        await sleep((seconds + 1) * 1000);
        continue;
      }
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok && !allow.includes(response.status)) {
        const detail =
          data && typeof data === "object"
            ? (data.message ?? JSON.stringify(data))
            : String(data ?? "").slice(0, 300);
        throw new ApiError(
          `${this.label}: ${method} ${path} -> ${response.status} ${detail}`,
          { status: response.status, method, path, data },
        );
      }
      return { status: response.status, ok: response.ok, data };
    }
  }

  async get(path, options) {
    return (await this.request("GET", path, options)).data;
  }
  async post(path, body, options) {
    return (await this.request("POST", path, { ...options, body })).data;
  }
  async put(path, body, options) {
    return (await this.request("PUT", path, { ...options, body })).data;
  }
  async patch(path, body, options) {
    return (await this.request("PATCH", path, { ...options, body })).data;
  }
}
