import { loadEnvFile, readConfig } from './config'
import type { DemoConfig } from './config'
import { createLatencyHistogram } from './latency'
import type { LatencyHistogram } from './latency'
import { renderReport } from './report'
import { createSlotTracker } from './slot-tracker'
import type { SlotTracker } from './slot-tracker'
import { startSlotStream } from './stream'
import type { SlotStream, StreamEvents } from './stream'

/**
 * Watches the slot stream, forces a disconnect partway through, and prints what
 * the reconnect actually recovered.
 *
 * Run with DROP_AFTER_MS to see replay in action; leave it at 0 to just measure.
 */

loadEnvFile('.env')

interface Session {
  tracker: SlotTracker
  latency: LatencyHistogram
  replayStartOffsets: number[]
  skippedByWindow: number
  startedAtMs: number
  finished: boolean
  timers: Array<ReturnType<typeof setTimeout>>
  stream: SlotStream | null
}

function bootstrap(): DemoConfig | null {
  try {
    return readConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return null
  }
}

function logResumeDelivered(requestedFromSlot: number, firstDeliveredSlot: number): void {
  const offset = firstDeliveredSlot - requestedFromSlot
  if (offset === 0) {
    console.info(`[resume] honoured: first delivered slot was ${firstDeliveredSlot}`)
    return
  }
  console.warn(
    `[resume] skipped ahead: asked for ${requestedFromSlot}, ` +
      `first delivery was ${firstDeliveredSlot} (${offset} slots later)`,
  )
}

function buildEvents(session: Session): StreamEvents {
  return {
    onSlot(slot, receivedAtMs, createdAt) {
      session.tracker.observe(slot, receivedAtMs)
      session.latency.observeSince(createdAt, receivedAtMs)
    },
    onResume(plan, attempt) {
      session.skippedByWindow += plan.skippedSlots
      const target = plan.fromSlot === null ? 'live head' : `slot ${plan.fromSlot}`
      const note = plan.clamped
        ? ` (clamped to the replay window, ${plan.skippedSlots} slots unrecoverable)`
        : ''
      console.info(`[resume] attempt ${attempt}, resuming at ${target}${note}`)
    },
    onResumeDelivered(requestedFromSlot, firstDeliveredSlot) {
      session.replayStartOffsets.push(firstDeliveredSlot - requestedFromSlot)
      logResumeDelivered(requestedFromSlot, firstDeliveredSlot)
    },
    onStatus(status, detail) {
      console.info(`[stream] ${status}: ${detail}`)
    },
  }
}

function finish(session: Session): void {
  if (session.finished) return
  session.finished = true
  for (const timer of session.timers) clearTimeout(timer)
  session.stream?.stop()
  console.info(
    renderReport({
      tracker: session.tracker,
      latency: session.latency,
      reconnects: session.stream?.reconnects() ?? 0,
      skippedByWindow: session.skippedByWindow,
      replayStartOffsets: session.replayStartOffsets,
      startedAtMs: session.startedAtMs,
      endedAtMs: Date.now(),
    }),
  )
  process.exit(0)
}

function scheduleDemoSteps(session: Session, config: DemoConfig): void {
  if (config.dropAfterMs > 0) {
    session.timers.push(
      setTimeout(() => {
        console.info(`[demo] forcing a disconnect after ${config.dropAfterMs}ms`)
        session.stream?.dropNow()
      }, config.dropAfterMs),
    )
  }
  if (config.durationMs > 0) {
    session.timers.push(setTimeout(() => finish(session), config.durationMs))
  }
}

function main(): void {
  const config = bootstrap()
  if (config === null) return

  const session: Session = {
    tracker: createSlotTracker({ suspiciousGapSlots: config.suspiciousGapSlots }),
    latency: createLatencyHistogram(),
    replayStartOffsets: [],
    skippedByWindow: 0,
    startedAtMs: Date.now(),
    finished: false,
    timers: [],
    stream: null,
  }

  session.stream = startSlotStream({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    maxReconnectAttempts: config.maxReconnectAttempts,
    events: buildEvents(session),
  })

  scheduleDemoSteps(session, config)
  process.on('SIGINT', () => finish(session))
  process.on('SIGTERM', () => finish(session))
}

main()
