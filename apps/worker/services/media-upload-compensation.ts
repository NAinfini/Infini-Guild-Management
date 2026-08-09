const COMPENSATION_ATTEMPTS = 3;

async function retryCompensation(task: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < COMPENSATION_ATTEMPTS; attempt++) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function deleteUploadedMedia(
  deleteObject: (key: string) => Promise<unknown>,
  keys: readonly string[],
): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const results = await Promise.allSettled(
    uniqueKeys.map((key) => retryCompensation(async () => {
      await deleteObject(key);
    })),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to remove ${failures.length} uploaded media object(s)`);
  }
}

export async function rethrowAfterUploadFailure(
  uploadError: unknown,
  deleteObject: (key: string) => Promise<unknown>,
  keys: readonly string[],
  rollbackDatabase?: () => Promise<void>,
): Promise<never> {
  const tasks: Array<() => Promise<void>> = [
    () => deleteUploadedMedia(deleteObject, keys),
  ];
  if (rollbackDatabase) tasks.unshift(() => retryCompensation(rollbackDatabase));

  const results = await Promise.allSettled(tasks.map((task) => task()));
  const cleanupFailures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [uploadError, ...cleanupFailures],
      "Upload failed and compensation was incomplete",
    );
  }
  throw uploadError;
}
