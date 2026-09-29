// A sign-in or sign-up started from the invitation page leaves a short-lived
// marker in sessionStorage. Only that marker lets the accept page join the user
// automatically: a link or URL parameter alone must never accept an invitation
// on someone's behalf.
const STORAGE_KEY = "kaneo:auto-accept-invitation";

export const AUTO_ACCEPT_MAX_AGE_MS = 30 * 60 * 1000;

export type AutoAcceptMarker = {
  invitationId: string;
  createdAt: number;
};

export function parseAutoAcceptMarker(
  raw: string | null,
): AutoAcceptMarker | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { invitationId, createdAt } = value as Partial<AutoAcceptMarker>;
    if (typeof invitationId !== "string" || !invitationId) return null;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
      return null;
    }
    return { invitationId, createdAt };
  } catch {
    return null;
  }
}

export function isAutoAcceptMarkerFresh(
  marker: AutoAcceptMarker,
  now: number,
): boolean {
  const age = now - marker.createdAt;
  // A negative age means the clock moved backwards; do not trust it.
  return age >= 0 && age <= AUTO_ACCEPT_MAX_AGE_MS;
}

export function writeAutoAcceptMarker(
  invitationId: string,
  now: number = Date.now(),
): void {
  try {
    const marker: AutoAcceptMarker = { invitationId, createdAt: now };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Storage is blocked or full; the user can still accept manually.
  }
}

export function clearAutoAcceptMarker(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function readAutoAcceptMarker(): AutoAcceptMarker | null {
  try {
    return parseAutoAcceptMarker(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Returns true, and removes the marker, when it was written for this
 * invitation within the last 30 minutes. A stale marker is removed without
 * granting anything. A marker for another invitation is left alone.
 */
export function consumeAutoAcceptMarker(
  invitationId: string,
  now: number = Date.now(),
): boolean {
  const marker = readAutoAcceptMarker();
  if (!marker || marker.invitationId !== invitationId) return false;
  clearAutoAcceptMarker();
  return isAutoAcceptMarkerFresh(marker, now);
}
