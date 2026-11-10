/**
 * Reconnect delay policy, kept pure so the schedule can be tested without
 * waiting on real timers.
 */

const BASE_DELAY_MS = 300
const MAX_DELAY_MS = 8000

/**
 * Exponential delay with full jitter.
 *
 * Jitter matters when several processes lose the same endpoint at once: without
 * it they all retry on the same tick and hit the server together. Full jitter
 * spreads the retries across the whole window.
 *
 * @param attempt 1 for the first retry, 2 for the second, and so on.
 * @param random Injection point for tests, expected to return [0, 1).
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs: number = BASE_DELAY_MS,
  capMs: number = MAX_DELAY_MS,
): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1
  const ceiling = Math.min(capMs, baseMs * 2 ** (safeAttempt - 1))
  const jittered = ceiling * random()
  return Math.max(0, Math.floor(jittered))
}
