/**
 * Delivery timing measured from the server's `createdAt` stamp to the moment
 * the update reaches the handler.
 *
 * The naive version, `Date.now() - createdAt`, does not work. The server clock
 * and your clock are not the same clock, and this endpoint reports timestamps a
 * few hundred milliseconds ahead of a typical laptop. Every sample is then
 * negative and a filter that drops negatives reports zero samples forever.
 *
 * So this module records the raw delta, negative included, and reports two
 * things: the floor (the best delivery observed, which doubles as an estimate of
 * clock lead) and the excess above that floor (how much slower each delivery was
 * than the best one). Excess is immune to constant clock skew, which is the part
 * that matters when comparing endpoints or regions.
 *
 * Buckets are fixed width, so memory does not grow with uptime.
 */

/** Bucket upper bounds in ms, ascending, covering negative skew. */
const BUCKET_BOUNDS_MS = [
  -5000, -2000, -1000, -500, -250, -100, -50, -20, -10, -5, -1, 0, 1, 2, 5, 10, 20, 30, 50, 70,
  100, 150, 200, 300, 500, 1000, 2000, 5000,
]

export interface LatencySummary {
  samples: number
  /** Best observed delta. Negative means the server clock leads the local one. */
  floorMs: number | null
  /** Estimated clock lead of the server over this machine, in ms. */
  clockLeadMs: number | null
  /** Delivery time above the floor. Resistant to constant clock skew. */
  excessP50Ms: number | null
  excessP95Ms: number | null
  excessP99Ms: number | null
  /** True when a sample fell outside the bounded range. */
  sawOverflow: boolean
}

function bucketIndexFor(ms: number): number {
  for (let i = 0; i < BUCKET_BOUNDS_MS.length; i += 1) {
    const bound = BUCKET_BOUNDS_MS[i]
    if (bound !== undefined && ms <= bound) return i
  }
  return BUCKET_BOUNDS_MS.length
}

/** Upper bound of the bucket holding the `share` quantile. */
function boundForShare(counts: readonly number[], total: number, share: number): number | null {
  if (total === 0) return null
  const target = Math.ceil(total * share)
  let seen = 0
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i] ?? 0
    if (seen >= target) return BUCKET_BOUNDS_MS[i] ?? null
  }
  return null
}

/** Lowest occupied bucket: the fastest delivery observed. */
function floorOf(counts: readonly number[]): number | null {
  for (let i = 0; i < counts.length; i += 1) {
    if ((counts[i] ?? 0) > 0) return BUCKET_BOUNDS_MS[i] ?? null
  }
  return null
}

function excess(quantile: number | null, floor: number | null): number | null {
  if (quantile === null || floor === null) return null
  return quantile - floor
}

function buildSummary(counts: readonly number[], total: number, sawOverflow: boolean): LatencySummary {
  const floor = floorOf(counts)
  return {
    samples: total,
    floorMs: floor,
    clockLeadMs: floor === null ? null : -floor,
    excessP50Ms: excess(boundForShare(counts, total, 0.5), floor),
    excessP95Ms: excess(boundForShare(counts, total, 0.95), floor),
    excessP99Ms: excess(boundForShare(counts, total, 0.99), floor),
    sawOverflow,
  }
}

export function createLatencyHistogram() {
  const counts = new Array<number>(BUCKET_BOUNDS_MS.length + 1).fill(0)
  let total = 0
  let sawOverflow = false

  function observe(ms: number): void {
    if (!Number.isFinite(ms)) return
    const index = bucketIndexFor(ms)
    counts[index] = (counts[index] ?? 0) + 1
    total += 1
    if (index === BUCKET_BOUNDS_MS.length) sawOverflow = true
  }

  return {
    /** Record a raw delta. Negative values are valid and must not be dropped. */
    observe,

    /** Delta between the server stamp and receipt time. */
    observeSince(createdAt: Date | null | undefined, nowMs: number = Date.now()): void {
      if (!createdAt) return
      observe(nowMs - createdAt.getTime())
    },

    summary(): LatencySummary {
      return buildSummary(counts, total, sawOverflow)
    },
  }
}

export type LatencyHistogram = ReturnType<typeof createLatencyHistogram>
