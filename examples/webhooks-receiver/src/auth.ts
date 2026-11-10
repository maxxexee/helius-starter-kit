import { timingSafeEqual } from 'node:crypto'

/**
 * Verification of the shared secret Helius echoes back.
 *
 * You set `authHeader` when creating the webhook. Helius sends that exact value
 * in the `Authorization` header on every delivery. Without this check, anyone
 * who learns your endpoint URL can post fake onchain events to it.
 *
 * Comparison is constant time so a wrong guess cannot be refined byte by byte
 * from response timings.
 */

/**
 * True only when `provided` matches a non-empty `expected` secret.
 *
 * An unset secret always fails. A receiver that accepts everything when the
 * environment variable is missing would turn a deploy mistake into an open
 * endpoint.
 */
export function isAuthorized(provided: string | null | undefined, expected: string): boolean {
  if (expected === '') return false
  if (typeof provided !== 'string' || provided === '') return false
  const given = Buffer.from(provided)
  const secret = Buffer.from(expected)
  if (given.length !== secret.length) return false
  return timingSafeEqual(given, secret)
}
