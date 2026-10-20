import type { ProgressUpdate } from "./command";

/** The open steps of one run, and the progress that opens and ends them. */
export type Steps = {
  /**
   * Sends one update on to the front-end, and keeps track of which steps are open. A second
   * `started` update for an open step is not sent: it throws the run's defect.
   */
  progress: (update: ProgressUpdate) => void;
  /** The run's defect, if any: a step started again while it was open. */
  defect: () => Error | undefined;
  /**
   * At the command's normal end, throws the run's defect, or one that names each open step. After
   * it, progress sends nothing on, so work the command did not wait for is not heard after the
   * outcome, and the result stays JSON mode's last line.
   */
  checkEnded: () => void;
  /**
   * Sends a `failed` update for each open step, in the order the steps started. After it, progress
   * sends nothing on, so a command that ignores the signal is not heard after its outcome.
   */
  closeAsFailed: () => void;
};

/**
 * The steps of one run. A step is open from its `started` update until a `done`, `failed` or
 * `skipped` update for the same step id. A step may also end with no `started` update first, as a
 * step that finishes at once or is skipped does. A step started again while it is open is a defect
 * in the command, because a front-end would show the step twice.
 */
export function trackSteps(send: (update: ProgressUpdate) => void): Steps {
  /** Each open step's title by its step id, in the order the steps started. */
  const open = new Map<string, string>();
  // Kept, and not only thrown, so a command that catches it still ends as a bug.
  let restarted: Error | undefined;
  let closed = false;
  return {
    progress(update) {
      if (closed) {
        return;
      }
      if (update.kind === "step") {
        if (update.status !== "started") {
          open.delete(update.step);
        } else if (open.has(update.step)) {
          restarted ??= new Error(
            `the command started step ${update.step} again while it was still open`,
          );
          throw restarted;
        } else {
          open.set(update.step, update.title);
        }
      }
      send(update);
    },
    defect: () => restarted,
    checkEnded() {
      closed = true;
      if (restarted !== undefined) {
        throw restarted;
      }
      if (open.size > 0) {
        const ids = [...open.keys()];
        const noun = ids.length === 1 ? "step" : "steps";
        throw new Error(`the command ended with ${noun} ${ids.join(", ")} still open`);
      }
    },
    closeAsFailed() {
      for (const [step, title] of open) {
        send({ kind: "step", step, title, status: "failed" });
      }
      open.clear();
      closed = true;
    },
  };
}
