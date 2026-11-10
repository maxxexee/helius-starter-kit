/**
 * Replay window math, kept pure so it can be tested without a network.
 *
 * LaserStream serves a rolling replay buffer (roughly 48 hours of slots). A
 * `fromSlot` older than the oldest servable slot makes the subscribe call fail
 * (OUT_OF_RANGE) instead of streaming. `subscribeReplayInfo()` reports that
 * lower bound; this module clamps a requested slot against it.
 */

/** Result of fitting a requested slot into the server's replay window. */
export interface ReplayClamp {
  /**
   * Slot to send in the subscribe request, or null to start at the live head.
   */
  fromSlot: number | null
  /** True when the request was moved forward or dropped to satisfy the window. */
  clamped: boolean
  /**
   * Slots the caller wanted but cannot get. Non-zero means real data loss that
   * should be surfaced to the user or the log, never silently ignored.
   */
  skippedSlots: number
}

/**
 * Fit `requested` into the window whose oldest servable slot is
 * `firstAvailable` (a decimal string, as the SDK returns uint64 values).
 *
 * Passing `requested = null` means "live head, no replay" and is always valid.
 */
export function clampFromSlot(
  requested: number | null,
  firstAvailable: string | undefined,
): ReplayClamp {
  if (requested === null || !Number.isFinite(requested) || requested <= 0) {
    return { fromSlot: null, clamped: false, skippedSlots: 0 }
  }
  const oldest = parseSlot(firstAvailable)
  if (oldest === null) {
    // The endpoint reports no replay data at all. Subscribing with an explicit
    // fromSlot would fail, so drop back to the live head and report the loss.
    return { fromSlot: null, clamped: true, skippedSlots: 0 }
  }
  if (requested >= oldest) {
    return { fromSlot: requested, clamped: false, skippedSlots: 0 }
  }
  return {
    fromSlot: oldest,
    clamped: true,
    skippedSlots: oldest - requested,
  }
}

/** Parse a decimal slot string. Returns null for absent or malformed input. */
export function parseSlot(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null
  return parsed
}
