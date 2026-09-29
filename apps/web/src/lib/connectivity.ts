import { HttpError } from "@/lib/http-error";

// The exact messages browsers give a fetch that got NO response at all (the
// device is offline, the server is down or unreachable, DNS/TLS failed, or a
// proxy dropped the connection). Matched as whole messages, not substrings, so
// an API error such as HttpError(500, "Failed to fetch tasks") — where the
// server DID answer — never reads as a lost connection:
//  - Chrome/Edge: "Failed to fetch"
//  - Firefox: "NetworkError when attempting to fetch resource."
//  - Safari: "Load failed" / "The network connection was lost."
const CONNECTIVITY_MESSAGES = [
  /^failed to fetch$/i,
  /^networkerror when attempting to fetch resource\.?$/i,
  /^load failed$/i,
  /^the network connection was lost\.?$/i,
  /^network request failed$/i,
];

function isHttpErrorLike(error: Error): boolean {
  return error instanceof HttpError || error.name === "HttpError";
}

/**
 * True when a request failed without any HTTP response from the API — the
 * browser is offline or the server cannot be reached. A fetch rejection is a
 * TypeError, but some wrappers (e.g. Better Auth's client in getWorkspaces)
 * re-throw its message on a plain Error, so the type itself is not required;
 * an HttpError (the server responded) never counts.
 */
export function isConnectivityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isHttpErrorLike(error)) return false;
  const message = error.message.trim();
  return CONNECTIVITY_MESSAGES.some((pattern) => pattern.test(message));
}

// Gateway statuses a reverse proxy / ingress returns when the API behind it is
// down or unreachable. On a same-origin deployment that is how a dead API shows
// up (the proxy still answers), rather than as a rejected fetch.
const GATEWAY_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export function isGatewayUnavailableStatus(status: number): boolean {
  return GATEWAY_UNAVAILABLE_STATUSES.has(status);
}

function httpStatusOf(error: unknown): number | null {
  if (!(error instanceof Error) || !isHttpErrorLike(error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** True when an error means the API itself is not reachable right now: no
 * response at all, or a proxy's gateway error standing in for it. */
export function indicatesServerUnreachable(error: unknown): boolean {
  if (isConnectivityError(error)) return true;
  const status = httpStatusOf(error);
  return status !== null && isGatewayUnavailableStatus(status);
}
