// A sign-in or sign-up started from the invitation page leaves a short-lived
// marker in localStorage, keyed by invitation. Only that marker lets the accept
// page join the user automatically: a link or URL parameter alone must never
// accept an invitation on someone's behalf.
//
// localStorage rather than sessionStorage because the way back from an email
// verification or magic link usually opens a new tab, which has its own empty
// sessionStorage. The accept page also requires the signed-in email to match
// the invitation, so a marker left behind by another person on a shared browser
// cannot join a different account.
const STORAGE_KEY_PREFIX = "kaneo:auto-accept-invitation:";

export const AUTO_ACCEPT_MAX_AGE_MS = 15 * 60 * 1000;

export type AutoAcceptMarker = {
  invitationId: string;
  createdAt: number;
};

function storageKey(invitationId: string): string {
  return `${STORAGE_KEY_PREFIX}${invitationId}`;
}

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

// Drops markers of other invitations that are past their window, so abandoned
// sign-ins do not accumulate in storage.
function pruneStaleMarkers(now: number): void {
  try {
    const staleKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
      const marker = parseAutoAcceptMarker(localStorage.getItem(key));
      if (!marker || !isAutoAcceptMarkerFresh(marker, now)) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) localStorage.removeItem(key);
  } catch {
    // Pruning is best effort.
  }
}

export function writeAutoAcceptMarker(
  invitationId: string,
  now: number = Date.now(),
): void {
  try {
    const marker: AutoAcceptMarker = { invitationId, createdAt: now };
    localStorage.setItem(storageKey(invitationId), JSON.stringify(marker));
    pruneStaleMarkers(now);
  } catch {
    // Storage is blocked or full; the user can still accept manually.
  }
}

/** Removes the marker: after it was used, after accepting or on decline. */
export function clearAutoAcceptMarker(invitationId: string): void {
  try {
    localStorage.removeItem(storageKey(invitationId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function readAutoAcceptMarker(
  invitationId: string,
): AutoAcceptMarker | null {
  try {
    const marker = parseAutoAcceptMarker(
      localStorage.getItem(storageKey(invitationId)),
    );
    return marker?.invitationId === invitationId ? marker : null;
  } catch {
    return null;
  }
}

/** True when a fresh marker exists for this invitation. Does not consume it. */
export function hasFreshAutoAcceptMarker(
  invitationId: string,
  now: number = Date.now(),
): boolean {
  const marker = readAutoAcceptMarker(invitationId);
  return marker !== null && isAutoAcceptMarkerFresh(marker, now);
}

/**
 * Returns true, and removes the marker, when it was written for this
 * invitation within the last 15 minutes. A stale marker is removed without
 * granting anything. Markers of other invitations are left alone.
 */
export function consumeAutoAcceptMarker(
  invitationId: string,
  now: number = Date.now(),
): boolean {
  const marker = readAutoAcceptMarker(invitationId);
  if (!marker) return false;
  clearAutoAcceptMarker(invitationId);
  return isAutoAcceptMarkerFresh(marker, now);
}
