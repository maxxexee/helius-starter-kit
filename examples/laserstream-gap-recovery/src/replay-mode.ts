/**
 * Does `fromSlot` reach the server when `replay` is false?
 *
 * The client type accepts `fromSlot` in a subscribe request either way, but the
 * two configs behave differently. This compares them against the same endpoint
 * so the difference is visible in one run:
 *
 *   replay=false + fromSlot  -> first delivery is ahead of the request,
 *                               nothing at or below head is delivered
 *   replay=true  + fromSlot  -> first delivery is the requested slot exactly
 *
 * Run with `npm run replay-mode`. Uses the same env vars as the demo.
 */
import { CommitmentLevel, LaserstreamClient, subscribe } from 'helius-laserstream'
import type { SubscribeRequest } from 'helius-laserstream'
import { readConfig } from './config'

const SAMPLE_MS = 6000

/** A slots-only subscription, which is the filter this demo cares about. */
function slotsRequest(fromSlot: number): SubscribeRequest {
  return {
    slots: { demo: { filterByCommitment: true } },
    commitment: CommitmentLevel.CONFIRMED,
    accounts: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    fromSlot,
  }
}

export interface ModeResult {
  label: string
  replay: boolean
  head: number
  requested: number
  firstDelivered: number | null
  offset: number | null
  backfilled: number
  delivered: number
}

/**
 * Subscribe once with `fromSlot` set `behind` slots under head and report what
 * came back. `offset` is how far the first delivery sat past the request.
 */
async function runMode(
  config: { apiKey: string; endpoint: string },
  label: string,
  replay: boolean,
  behind: number,
): Promise<ModeResult> {
  const unary = new LaserstreamClient({ apiKey: config.apiKey, endpoint: config.endpoint })
  const head = Number((await unary.getSlot(CommitmentLevel.CONFIRMED)).slot)
  const requested = head - behind
  const delivered: number[] = []
  let firstDelivered: number | null = null

  const handle = await subscribe(
    { apiKey: config.apiKey, endpoint: config.endpoint, replay, maxReconnectAttempts: 1 },
    slotsRequest(requested),
    (update) => {
      const raw = update.slot?.slot
      if (raw == null) return
      const slot = Number(raw)
      delivered.push(slot)
      if (firstDelivered === null) firstDelivered = slot
    },
    () => {},
  )

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
  handle.cancel()

  return {
    label,
    replay,
    head,
    requested,
    firstDelivered,
    offset: firstDelivered === null ? null : firstDelivered - requested,
    backfilled: delivered.filter((slot) => slot <= head).length,
    delivered: delivered.length,
  }
}

function describe(result: ModeResult): string {
  const first = result.firstDelivered ?? 'none'
  const offset = result.offset === null ? 'n/a' : String(result.offset)
  return [
    `${result.label}: replay=${result.replay}`,
    `head=${result.head}`,
    `requested=${result.requested}`,
    `first=${first}`,
    `offset=${offset}`,
    `backfilled=${result.backfilled}/${result.delivered}`,
  ].join(' ')
}

export async function main(): Promise<void> {
  const config = readConfig()
  const results = [
    await runMode(config, 'A', false, 20),
    await runMode(config, 'B', true, 20),
    await runMode(config, 'C', true, 5),
  ]

  console.info('\nfromSlot with replay disabled vs enabled\n')
  for (const result of results) console.info(describe(result))

  const [stripped, honoured] = results
  if (stripped === undefined || honoured === undefined) {
    throw new Error('expected three mode results')
  }
  const line = (mode: ModeResult): string =>
    `replay=${String(mode.replay).padEnd(5)} backfilled ${mode.backfilled} of ${mode.delivered}, offset ${mode.offset}`

  console.info('\nbackfilled counts slots delivered at or below head, offset counts past the request\n')
  console.info(line(stripped))
  console.info(line(honoured))
  console.info(
    '\nWith replay=false the SDK drops fromSlot before sending, so the resume recovers nothing.',
  )
}

const invokedDirectly = process.argv[1]?.endsWith('replay-mode.ts') ?? false
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
