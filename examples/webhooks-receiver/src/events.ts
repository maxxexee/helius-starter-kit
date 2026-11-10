/**
 * Parsing for a Helius webhook delivery.
 *
 * Helius always posts a JSON **array** of events, even when there is one. Code
 * written against a single object works in testing and then breaks the first
 * time two transactions confirm in the same batch.
 *
 * Failures are returned as values rather than thrown, so the caller decides what
 * status code a bad payload deserves.
 */

export interface HeliusEvent {
  /** Transaction signature. The idempotency key for this event. */
  signature: string
  slot: number | null
  type: string | null
  /** Original object, for fields this demo does not model. */
  raw: Record<string, unknown>
}

export type ParseResult =
  | { ok: true; events: HeliusEvent[]; rejected: number }
  | { ok: false; reason: 'not-json' | 'not-array' }

function toEvent(item: unknown): HeliusEvent | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  const signature = record.signature
  if (typeof signature !== 'string' || signature === '') return null
  const slot = typeof record.slot === 'number' ? record.slot : null
  const type = typeof record.type === 'string' ? record.type : null
  return { signature, slot, type, raw: record }
}

/**
 * Parse a raw request body into events.
 *
 * Entries without a signature are counted as rejected rather than failing the
 * whole batch: one bad entry should not cost you the other four.
 */
export function parseEvents(body: string): ParseResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  if (!Array.isArray(decoded)) return { ok: false, reason: 'not-array' }

  const events: HeliusEvent[] = []
  let rejected = 0
  for (const item of decoded) {
    const event = toEvent(item)
    if (event === null) rejected += 1
    else events.push(event)
  }
  return { ok: true, events, rejected }
}
