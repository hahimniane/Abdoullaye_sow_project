import type { ActionRunner } from "./action-confirmation.ts";

export type SupportActionResult = {
  completed: boolean;
  error: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tracks whether the underlying support mutation actually ran successfully.
 *
 * The console-level ActionRunner intentionally reports failures through a toast
 * instead of rethrowing them. Transactional forms still need a reliable result
 * so they do not clear the user's draft or close after a swallowed failure.
 */
export async function executeSupportAction(
  label: string,
  action: () => Promise<unknown>,
  runAction?: ActionRunner,
): Promise<SupportActionResult> {
  let completed = false;
  let capturedError: unknown;

  const trackedAction = async () => {
    try {
      await action();
      completed = true;
    } catch (error) {
      capturedError = error;
      throw error;
    }
  };

  try {
    if (runAction) {
      await runAction(label, trackedAction);
    } else {
      await trackedAction();
    }
  } catch (error) {
    capturedError ??= error;
  }

  return {
    completed,
    error: capturedError === undefined ? "" : errorMessage(capturedError),
  };
}
