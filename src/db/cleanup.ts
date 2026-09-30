/**
 * Undo steps for a single test.
 *
 * Register an undo right after changing something; all undo steps run after the
 * test in reverse order — also when the test fails, which is the point: a failing
 * test must not leave crons disabled or settings changed for the next one.
 *
 *   await disableAllCrons(db.hub);
 *   cleanup.add('restore crons', () => resetAllCrons(db.hub));
 *
 * A database transaction cannot do this job: hub, checkout and the APIs write
 * through their own connections, so rolling back the test's connection would not
 * undo their writes.
 */
// Created fresh for every test by the `cleanup` fixture (src/fixtures/index.ts);
// the fixture calls runAll() after the test finishes.
export class Cleanup {
  private readonly steps: { label: string; run: () => Promise<unknown> }[] = [];

  add(label: string, run: () => Promise<unknown>): void {
    this.steps.push({ label, run });
  }

  async runAll(): Promise<void> {
    const errors: string[] = [];
    for (const step of this.steps.reverse()) {
      try {
        await step.run();
      } catch (error) {
        errors.push(`${step.label}: ${(error as Error).message}`);
      }
    }
    this.steps.length = 0;
    if (errors.length > 0) {
      throw new Error(`Cleanup failed:\n  - ${errors.join('\n  - ')}`);
    }
  }
}
