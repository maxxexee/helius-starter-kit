import { CommitmentLevel, LaserstreamClient, subscribe } from 'helius-laserstream'
import type {
  LaserstreamConfig,
  StreamHandle,
  SubscribeRequest,
  SubscribeUpdate,
} from 'helius-laserstream'
import { backoffDelayMs } from './backoff'
import { clampFromSlot } from './replay-window'
import type { ReplayClamp } from './replay-window'

/**
 * Owns the subscription lifecycle: connect, detect death, preflight the replay
 * window, reconnect from the first missing slot, and give up cleanly.
 *
 * `replay` is false on purpose. The SDK can resume for you, but then the resume
 * is invisible: you cannot report how many slots were recovered, and an
 * OUT_OF_RANGE past the retention window arrives as an error on a stream you no
 * longer control. Resuming here keeps every recovered slot countable.
 */

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'stopped'

export interface StreamEvents {
  onSlot(slot: number, receivedAtMs: number, createdAt: Date | null): void
  /** Called before each resume with the clamped plan and what was lost. */
  onResume(plan: ReplayClamp, attempt: number): void
  /**
   * Fires once per resume, on the first slot delivered afterwards. When the
   * stream honours `fromSlot` the two values match. A positive offset means the
   * server accepted the request but started later than asked, which is silent
   * data loss unless something measures it.
   */
  onResumeDelivered(requestedFromSlot: number, firstDeliveredSlot: number): void
  onStatus(status: StreamStatus, detail: string): void
}

export interface SlotStream {
  /** Force a disconnect, as a network failure would. */
  dropNow(): void
  stop(): void
  reconnects(): number
}

interface StreamState {
  handle: StreamHandle | null
  lastSlot: number
  stopping: boolean
  failures: number
  liveCount: number
  /** Slot asked for on the current resume, cleared once data arrives. */
  pendingResume: number | null
  timer: ReturnType<typeof setTimeout> | null
  /** Guards against a stale stream firing errors after a newer one is live. */
  generation: number
}

interface Ctx {
  apiKey: string
  endpoint: string
  maxReconnectAttempts: number
  events: StreamEvents
  config: LaserstreamConfig
  state: StreamState
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildSlotRequest(fromSlot: number | null): SubscribeRequest {
  const request: SubscribeRequest = {
    slots: { demo: { filterByCommitment: true } },
    commitment: CommitmentLevel.CONFIRMED,
    accounts: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
  }
  if (fromSlot !== null) request.fromSlot = fromSlot
  return request
}

function slotFromUpdate(update: SubscribeUpdate): number | null {
  const raw = update.slot?.slot
  if (raw === undefined || raw === null) return null
  const slot = Number(raw)
  return Number.isSafeInteger(slot) && slot > 0 ? slot : null
}

/** Oldest replayable slot, or undefined when the endpoint reports none. */
async function replayFloor(apiKey: string, endpoint: string): Promise<string | undefined> {
  const client = new LaserstreamClient({ apiKey, endpoint })
  try {
    const info = await client.subscribeReplayInfo()
    return info.firstAvailable
  } finally {
    client.close()
  }
}

/** Resolve the resume point, tolerating a replay-info call that fails. */
async function planResume(ctx: Ctx): Promise<ReplayClamp> {
  if (ctx.state.lastSlot === 0) return { fromSlot: null, clamped: false, skippedSlots: 0 }
  const requested = ctx.state.lastSlot + 1
  let floor: string | undefined
  try {
    floor = await replayFloor(ctx.apiKey, ctx.endpoint)
  } catch {
    // Without the floor there is no way to know the request is servable.
    // Resuming at the live head is the only safe option; the loss is reported.
    return { fromSlot: null, clamped: true, skippedSlots: 0 }
  }
  return clampFromSlot(requested, floor)
}

function handleUpdate(ctx: Ctx, generation: number, update: SubscribeUpdate): void {
  if (generation !== ctx.state.generation) return
  const slot = slotFromUpdate(update)
  if (slot === null) return
  if (ctx.state.pendingResume !== null) {
    ctx.events.onResumeDelivered(ctx.state.pendingResume, slot)
    ctx.state.pendingResume = null
  }
  if (slot > ctx.state.lastSlot) ctx.state.lastSlot = slot
  ctx.events.onSlot(slot, Date.now(), update.createdAt ?? null)
}

function scheduleReconnect(ctx: Ctx, reason: string): void {
  if (ctx.state.stopping || ctx.state.timer !== null) return
  ctx.state.failures += 1
  if (ctx.state.failures > ctx.maxReconnectAttempts) {
    ctx.events.onStatus('failed', `gave up after ${ctx.maxReconnectAttempts} attempts (${reason})`)
    return
  }
  const delay = backoffDelayMs(ctx.state.failures)
  ctx.events.onStatus('reconnecting', `${reason}, retrying in ${delay}ms`)
  ctx.state.timer = setTimeout(() => {
    ctx.state.timer = null
    void connectOnce(ctx)
  }, delay)
}

function onStreamError(ctx: Ctx, generation: number, error: Error): void {
  if (generation !== ctx.state.generation) return
  ctx.state.handle = null
  scheduleReconnect(ctx, error.message || 'stream error')
}

async function connectOnce(ctx: Ctx): Promise<void> {
  if (ctx.state.stopping) return
  ctx.state.generation += 1
  const generation = ctx.state.generation
  const isReconnect = ctx.state.liveCount > 0
  ctx.events.onStatus(isReconnect ? 'reconnecting' : 'connecting', ctx.endpoint)

  const plan = await planResume(ctx)
  ctx.state.pendingResume = plan.fromSlot
  if (isReconnect || plan.clamped) ctx.events.onResume(plan, ctx.state.failures + 1)

  try {
    const handle = await subscribe(
      ctx.config,
      buildSlotRequest(plan.fromSlot),
      (update) => handleUpdate(ctx, generation, update),
      (error) => onStreamError(ctx, generation, error),
    )
    if (generation !== ctx.state.generation || ctx.state.stopping) {
      handle.cancel()
      return
    }
    ctx.state.handle = handle
    ctx.state.failures = 0
    ctx.state.liveCount += 1
    const detail = plan.fromSlot === null ? 'at live head' : `replay from ${plan.fromSlot}`
    ctx.events.onStatus('live', detail)
  } catch (error) {
    scheduleReconnect(ctx, `connect failed: ${messageOf(error)}`)
  }
}

function shutdown(ctx: Ctx): void {
  ctx.state.stopping = true
  if (ctx.state.timer !== null) clearTimeout(ctx.state.timer)
  ctx.state.timer = null
  ctx.state.handle?.cancel()
  ctx.state.handle = null
  ctx.events.onStatus('stopped', 'shutdown requested')
}

function disconnect(ctx: Ctx, reason: string): void {
  ctx.state.handle?.cancel()
  ctx.state.handle = null
  ctx.state.generation += 1 // ignore anything still in flight
  scheduleReconnect(ctx, reason)
}

export function startSlotStream(options: {
  apiKey: string
  endpoint: string
  maxReconnectAttempts: number
  events: StreamEvents
}): SlotStream {
  const { apiKey, endpoint, maxReconnectAttempts, events } = options
  const ctx: Ctx = {
    apiKey,
    endpoint,
    maxReconnectAttempts,
    events,
    // maxReconnectAttempts is enforced above, so the SDK must not retry too.
    config: { apiKey, endpoint, replay: false, maxReconnectAttempts: 1 },
    state: {
      handle: null,
      lastSlot: 0,
      stopping: false,
      failures: 0,
      liveCount: 0,
      pendingResume: null,
      timer: null,
      generation: 0,
    },
  }

  void connectOnce(ctx)

  return {
    dropNow: () => disconnect(ctx, 'forced drop'),
    stop: () => shutdown(ctx),
    reconnects: () => Math.max(0, ctx.state.liveCount - 1),
  }
}
