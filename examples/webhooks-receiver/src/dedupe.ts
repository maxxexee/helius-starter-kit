/**
 * Duplicate suppression keyed on transaction signature.
 *
 * Helius retries a delivery when your endpoint returns 5xx, a 4xx other than
 * 403, times out, or the connection fails. A retry is not a new event, so the
 * same `signature` can arrive more than once and any handler that moves money,
 * sends a notification, or writes a row must be idempotent.
 *
 * The cache is bounded: it evicts in insertion order once full, so memory stays
 * flat on a process that runs for months. Insertion order is close enough to age
 * for this purpose, since signatures arrive roughly in time order.
 */

const DEFAULT_CAPACITY = 5000

export function createSignatureCache(capacity: number = DEFAULT_CAPACITY) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError(`capacity must be a positive integer, received ${capacity}`)
  }
  const seen = new Set<string>()

  return {
    /**
     * True the first time a signature is offered, false on every repeat.
     * An empty signature is never considered new, so a malformed payload cannot
     * evict a real entry.
     */
    firstSighting(signature: string): boolean {
      if (signature === '') return false
      if (seen.has(signature)) return false
      seen.add(signature)
      if (seen.size > capacity) {
        const oldest = seen.values().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      return true
    },

    size(): number {
      return seen.size
    },

    capacity(): number {
      return capacity
    },
  }
}

export type SignatureCache = ReturnType<typeof createSignatureCache>
