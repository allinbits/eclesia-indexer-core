/**
 * Races a promise against a timer and clears the timer however the race settles,
 * so a finished operation never leaves a pending timeout keeping the event loop alive.
 * @param promise - The operation to bound
 * @param ms - Milliseconds to wait before rejecting
 * @param error - Error to reject with when the timer wins
 * @returns The promise's value, or a rejection with `error` on timeout
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, error: Error): Promise<T> => {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(error), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle) {
      clearTimeout(handle);
    }
  });
};

/**
 * Restart delay for the n-th consecutive failure: exponential from `baseMs`, capped at `maxMs`.
 * @param attempt - 1 for the first restart, 2 for the second, and so on
 */
export const retryDelay = (attempt: number, baseMs: number, maxMs: number): number => {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(baseMs * Math.pow(2, exponent), maxMs);
};
