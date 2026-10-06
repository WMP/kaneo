// Single source of truth for the day offset a finish-to-start dependency adds.
// Task dates are whole days and a task occupies its end day, so a finish-to-
// start successor may begin on the day AFTER the predecessor's end day (then
// plus the lag, then nudged to the next working day by the callers that have a
// calendar). Start-to-start, finish-to-finish and start-to-finish tie two
// points of the same kind, so they carry no offset.
//
// Used by the dependency cascade, the derived (display-only) schedule and the
// critical path so the three cannot drift apart.
export const FS_HANDOFF_DAYS = 1;
