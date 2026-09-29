import { resolveApiBaseUrl } from "@kaneo/libs";
import { isGatewayUnavailableStatus } from "@/lib/connectivity";

// Lightweight reachability probe used while the connection banner is shown.
// /health is a plain (non-OpenAPI) route, so it is not on the typed client —
// same pattern as getInstanceStatus. Reachability, not health: any response
// counts as reachable except a proxy's gateway error (the API behind it is
// down); a rejected fetch (still unreachable) resolves false, never throws.
export async function checkApiReachable(
  signal?: AbortSignal,
): Promise<boolean> {
  const baseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      credentials: "include",
      cache: "no-store",
      signal,
    });
    return !isGatewayUnavailableStatus(response.status);
  } catch {
    return false;
  }
}
