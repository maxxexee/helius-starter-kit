import type { LatencyHistogram } from './latency'
import type { SlotTracker } from './slot-tracker'

/** Formats the end-of-run summary. Kept separate so the demo's I/O stays thin. */

export interface ReportInput {
  tracker: SlotTracker
  latency: LatencyHistogram
  reconnects: number
  skippedByWindow: number
  /**
   * Slots between the slot a resume asked for and the slot actually delivered
   * next. 0 means the replay request was honoured exactly.
   */
  replayStartOffsets: readonly number[]
  startedAtMs: number
  endedAtMs: number
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function fixed(value: number | null, unit: string): string {
  return value === null ? 'n/a' : `${value}${unit}`
}

/** "none" when no resume happened, otherwise one offset per resume. */
function offsetsText(offsets: readonly number[]): string {
  if (offsets.length === 0) return 'none (no resume)'
  const allHonoured = offsets.every((offset) => offset === 0)
  const suffix = allHonoured
    ? ' (honoured)'
    : ' (request carried no fromSlot, so the stream began at the live head)'
  return `${offsets.join(', ')}${suffix}`
}

function rows(input: ReportInput): Array<[string, string]> {
  const stats = input.tracker.stats()
  const latency = input.latency.summary()
  const elapsedS = Math.max(0.001, (input.endedAtMs - input.startedAtMs) / 1000)
  return [
    ['Wall clock', `${elapsedS.toFixed(1)}s`],
    ['Slot updates received', String(stats.updates)],
    ['Distinct slots', String(stats.distinctSlots)],
    ['Slot window', stats.firstSlot === null ? 'n/a' : `${stats.firstSlot} to ${stats.lastSlot}`],
    ['Observed slot rate', `${(stats.distinctSlots / elapsedS).toFixed(2)} slots/s`],
    ['Coverage of window', percent(stats.coverage)],
    ['Slots not delivered', String(stats.missedSlots)],
    [`Largest gap (>= ${input.tracker.threshold()})`, String(stats.largestGap)],
    ['Suspicious gaps', String(stats.suspiciousGaps)],
    ['Reconnects', String(input.reconnects)],
    ['Slots lost to replay window', String(input.skippedByWindow)],
    ['Replay start offset(s)', offsetsText(input.replayStartOffsets)],
    ['Server clock lead', fixed(latency.clockLeadMs, 'ms')],
    ['Delivery excess p50', fixed(latency.excessP50Ms, 'ms')],
    ['Delivery excess p95', fixed(latency.excessP95Ms, 'ms')],
    ['Delivery samples', String(latency.samples)],
  ]
}

export function renderReport(input: ReportInput): string {
  const lines = rows(input).map(([label, value]) => `  ${label.padEnd(30)} ${value}`)
  const gaps = input.tracker.gaps()
  const gapLines =
    gaps.length === 0
      ? ['  none']
      : gaps.map((gap) => `  ${gap.fromSlot} -> ${gap.toSlot} (missed ${gap.size})`)
  return [
    '',
    'LaserStream run summary',
    '--------------------------------------------------------',
    ...lines,
    '',
    'Retained gaps:',
    ...gapLines,
    '',
  ].join('\n')
}
