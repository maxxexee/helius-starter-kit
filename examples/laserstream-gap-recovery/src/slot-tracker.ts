/**
 * Tracks the slot stream and decides what counts as a real gap.
 *
 * Solana slot numbers are contiguous, but slot *updates* are not: a skipped
 * slot produces no block, so no slot update, so a jump of more than one slot is
 * ordinary network behaviour. A detector that alarms on `delta > 1` therefore
 * cries wolf constantly. This tracker keeps the raw statistics and only flags
 * jumps at or above `suspiciousGapSlots`, which the caller sets from measurement
 * rather than from guesswork.
 */

/** One observed jump larger than a single slot. */
export interface SlotGap {
  fromSlot: number
  toSlot: number
  size: number
  atMs: number
}

export interface SlotStats {
  firstSlot: number | null
  lastSlot: number
  updates: number
  /** Slots observed as distinct update values. */
  distinctSlots: number
  /** lastSlot - firstSlot + 1: the window the stream covered. */
  span: number
  /** distinctSlots / span. 1.0 means every slot in the window produced an update. */
  coverage: number
  /** Jumps at or above suspiciousGapSlots. */
  suspiciousGaps: number
  largestGap: number
  /** Sum of all missing slots inside the observed window. */
  missedSlots: number
}

export interface SlotTrackerOptions {
  /** Jumps of at least this many slots are counted as suspicious. Default 5. */
  suspiciousGapSlots?: number
  /** How many recent gaps to retain for the summary. Default 20. */
  keepGaps?: number
}

const DEFAULT_SUSPICIOUS_GAP_SLOTS = 5
const DEFAULT_KEEP_GAPS = 20

/**
 * Running gap totals plus the recent suspicious ones.
 *
 * Only a bounded window of gaps is retained: an unbounded array would grow with
 * uptime, and the totals are what the report actually needs.
 */
function createGapLedger(threshold: number, keepGaps: number) {
  let suspicious = 0
  let largest = 0
  let missed = 0
  const recent: SlotGap[] = []

  return {
    record(fromSlot: number, toSlot: number, atMs: number): void {
      const size = toSlot - fromSlot - 1
      if (size <= 0) return
      missed += size
      if (size > largest) largest = size
      if (size < threshold) return
      suspicious += 1
      recent.push({ fromSlot, toSlot, size, atMs })
      if (recent.length > keepGaps) recent.shift()
    },

    totals(): { suspicious: number; largest: number; missed: number } {
      return { suspicious, largest, missed }
    },

    gaps(): readonly SlotGap[] {
      return recent
    },
  }
}

function computeStats(input: {
  firstSlot: number | null
  lastSlot: number
  updates: number
  distinctSlots: number
  suspicious: number
  largest: number
  missed: number
}): SlotStats {
  const span = input.firstSlot === null ? 0 : input.lastSlot - input.firstSlot + 1
  return {
    firstSlot: input.firstSlot,
    lastSlot: input.lastSlot,
    updates: input.updates,
    distinctSlots: input.distinctSlots,
    span,
    coverage: span === 0 ? 0 : input.distinctSlots / span,
    suspiciousGaps: input.suspicious,
    largestGap: input.largest,
    missedSlots: input.missed,
  }
}

interface TrackerState {
  firstSlot: number | null
  lastSlot: number
  updates: number
  distinctSlots: number
}

type GapLedger = ReturnType<typeof createGapLedger>

function observeSlot(state: TrackerState, ledger: GapLedger, slot: number, atMs: number): void {
  if (!Number.isSafeInteger(slot) || slot <= 0) return
  state.updates += 1
  if (state.firstSlot === null) {
    state.firstSlot = slot
    state.lastSlot = slot
    state.distinctSlots = 1
    return
  }
  // A late replay frame for a slot already counted, or a repeat of the head.
  if (slot <= state.lastSlot) return
  state.distinctSlots += 1
  ledger.record(state.lastSlot, slot, atMs)
  state.lastSlot = slot
}

function statsFrom(state: TrackerState, ledger: GapLedger): SlotStats {
  const { suspicious, largest, missed } = ledger.totals()
  return computeStats({ ...state, suspicious, largest, missed })
}

export function createSlotTracker(options: SlotTrackerOptions = {}) {
  const threshold = options.suspiciousGapSlots ?? DEFAULT_SUSPICIOUS_GAP_SLOTS
  const ledger = createGapLedger(threshold, options.keepGaps ?? DEFAULT_KEEP_GAPS)
  const state: TrackerState = { firstSlot: null, lastSlot: 0, updates: 0, distinctSlots: 0 }

  return {
    /** Feed one slot number. Out of order and duplicate updates are tolerated. */
    observe(slot: number, atMs: number = Date.now()): void {
      observeSlot(state, ledger, slot, atMs)
    },

    stats(): SlotStats {
      return statsFrom(state, ledger)
    },

    /** The retained suspicious gaps, oldest first. */
    gaps(): readonly SlotGap[] {
      return ledger.gaps()
    },

    threshold(): number {
      return threshold
    },
  }
}

export type SlotTracker = ReturnType<typeof createSlotTracker>
