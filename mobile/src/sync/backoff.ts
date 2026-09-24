/**
 * How long a failed sync operation waits before it is tried again.
 *
 * The queue already counted attempts, but nothing read the count, so a
 * failing operation was retried at full speed forever — flattening the battery
 * of a rider who happens to be out of signal, and hammering the API the moment
 * it comes back. Doubling the wait, with a cap and some jitter so a fleet of
 * phones does not retry in lockstep, fixes both.
 */
export type BackoffOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Fraction of the delay that is randomised, to spread retries out. */
  jitterRatio?: number;
  random?: () => number;
};

export const syncBackoffDefaults = {
  baseDelayMs: 5_000,
  maxDelayMs: 15 * 60_000,
  jitterRatio: 0.25,
} as const;

export function backoffDelayMs(attempts: number, options: BackoffOptions = {}) {
  const baseDelayMs = options.baseDelayMs ?? syncBackoffDefaults.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? syncBackoffDefaults.maxDelayMs;
  const jitterRatio = options.jitterRatio ?? syncBackoffDefaults.jitterRatio;
  const random = options.random ?? Math.random;

  const safeAttempts = Math.max(1, Math.floor(attempts));
  // Doubling past ~20 attempts overflows into Infinity, and the cap makes
  // anything beyond it irrelevant anyway.
  const exponent = Math.min(safeAttempts - 1, 30);
  const delay = Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
  const jitter = delay * jitterRatio * random();

  return Math.round(Math.min(delay + jitter, maxDelayMs * (1 + jitterRatio)));
}

export function nextAttemptAt(
  attempts: number,
  now = Date.now(),
  options: BackoffOptions = {}
) {
  return now + backoffDelayMs(attempts, options);
}

/**
 * An operation that keeps failing is a problem to show a rider, not something
 * to keep retrying quietly.
 */
export const failingAttemptThreshold = 4;
