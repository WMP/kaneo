// Runs cleanup steps one after the other so that a failing step does not skip
// the ones after it. Every failure is logged (with its label); once all steps
// ran, the first failure is thrown, so nothing is masked and the caller still
// sees that the cleanup did not fully succeed.
export async function runIndependently(
  steps: Array<[label: string, run: () => Promise<unknown>]>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (error) {
      console.error(`${label} failed:`, error);
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
