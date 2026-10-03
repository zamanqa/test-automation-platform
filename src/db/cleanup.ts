// Undo steps for one test. Add an undo step right after changing something:
//
//   await disableAllCrons(db.hub);
//   cleanup.add('restore crons', () => resetAllCrons(db.hub));
//
// The steps run after the test in reverse order, also when the test fails,
// so a failed test never leaves crons off or a setting changed.
// The `cleanup` fixture creates one for every test and calls runAll() at the end.
export class Cleanup {
  private steps: { label: string; run: () => Promise<unknown> }[] = [];

  add(label: string, run: () => Promise<unknown>): void {
    this.steps.push({ label, run });
  }

  async runAll(): Promise<void> {
    const errors: string[] = [];
    const lastFirst = this.steps.reverse();

    for (const step of lastFirst) {
      try {
        await step.run();
      } catch (error) {
        errors.push(`${step.label}: ${(error as Error).message}`);
      }
    }

    this.steps = [];
    if (errors.length > 0) {
      throw new Error(`Cleanup failed:\n  - ${errors.join('\n  - ')}`);
    }
  }
}
