// The scale choices of the dependency-neighborhood card. Kept free of the
// model's formatting and i18n imports because the user-preferences store
// persists the choice and must stay cheap (and mock-friendly) to import.

import { GANTT_UNITS, type GanttUnit } from "./timeline";

/** The card's scale choice: "fit" fits the range into the card (never below
 * MIN_PIXELS_PER_DAY); a unit uses that unit's fixed width per day, the same
 * units the main Gantt toolbar offers. */
export type NeighborhoodZoom = "fit" | GanttUnit;

export const NEIGHBORHOOD_ZOOMS: readonly NeighborhoodZoom[] = [
  "fit",
  ...GANTT_UNITS,
];

export const DEFAULT_NEIGHBORHOOD_ZOOM: NeighborhoodZoom = "fit";

export function isNeighborhoodZoom(value: unknown): value is NeighborhoodZoom {
  return NEIGHBORHOOD_ZOOMS.includes(value as NeighborhoodZoom);
}
