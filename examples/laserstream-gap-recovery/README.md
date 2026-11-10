# LaserStream gap recovery, measured

A LaserStream consumer that measures what a reconnect actually recovers, instead of assuming it recovered everything.

Most streaming examples print the first message and stop. That works until your process dies for six seconds on mainnet and you have to answer a harder question: did replay give me back every slot I missed, or did it quietly start somewhere else?

This repo answers that with numbers. Running it produced three findings, all documented below with the exact data.

## Finding 1: `replay: false` silently discards `fromSlot`

The client type accepts `fromSlot` in a subscribe request whether or not replay is enabled. With `replay: false` the SDK drops it before the request is sent, so the server never sees it and the stream starts at the live head. Nothing errors, nothing warns, and the resume you carefully planned recovers nothing.

`npm run replay-mode` compares the two configs on one endpoint. Same subscription, same `fromSlot`, only the config differs:

| Mode | `replay` | Requested | First delivered | Offset | Delivered at or below head |
|---|---|---|---|---|---|
| A | `false` | head - 20 | head + 5 | **+25** | 0 of 21 |
| B | `true` | head - 20 | head - 20 | **0** | 21 of 46 |
| C | `true` | head - 5 | head - 5 | **0** | 6 of 31 |

The server is not the problem. With replay enabled it honours the request exactly, first delivery is the requested slot, and the historical range arrives. The trap is that the two settings are independent in the API surface but not in their effect: `fromSlot` is only meaningful when `replay` is true, and pairing it with `replay: false` fails silently rather than being rejected.

That is why the demo in `src/` passes `fromSlot` itself. It sets `replay: false` on purpose so the resume is visible and countable, and the consequence is that the resume does not happen: the run reports an offset of 6 to 9 slots, which is the time between deciding to resume and the server pinning the stream to head, not data the server failed to send. Earlier versions of this README blamed the server for that. They were wrong, and this is the correction.

**What to do about it:** set `replay: true` and pass `fromSlot`, and let either the SDK or your own reconnect logic resume, because that combination is the one that actually replays. If you want a hand-rolled resume loop for accounting reasons, you cannot have it with `replay: false`; measure the SDK's resume instead.

**Open question worth checking:** the SDK README says replay covers 3000 slots (~20 minutes), while `subscribeReplayInfo()` reported `firstAvailable = 519910513` against a head of `520774579`, about 864,000 slots or 48 hours. That may be a guaranteed floor versus what happens to be retained, and this repo does not settle which.

## Finding 2: `createdAt` deltas are negative, so naive latency math breaks

The obvious way to measure delivery latency is:

```ts
const latency = Date.now() - update.createdAt.getTime()
```

On every run, this was negative. Five consecutive slot updates:

```
createdAt 2026-11-10T14:51:14.807Z   now 1794322274572   delta -235
createdAt 2026-11-10T14:51:14.807Z   now 1794322274573   delta -234
```

The server clock leads the local machine by roughly 100 to 235 ms. Any code that drops negative samples (a very natural guard) records zero latency samples forever and reports `n/a` while looking completely healthy. That is what my first version did.

The fix is to stop treating the absolute delta as latency. Record the raw delta, negative included, and report two numbers:

- **floor**: the fastest delivery observed. On a healthy run this is the clock lead plus the real minimum transit time.
- **excess**: how much slower than the floor each delivery was. Constant clock skew cancels out, so this is comparable across regions and machines.

That is what `src/latency.ts` does. It is a fixed-width histogram, so memory does not grow with uptime.

## Finding 3 (the boring one that matters): normal slot streams are not contiguous

Coverage of the observed slot window was 90 to 94 percent across runs, with 6 to 11 slot numbers never delivered, on a stream that was never disconnected.

Solana slot numbers are contiguous. Slot *updates* are not: a skipped slot produces no block, so nothing to notify. A detector that alarms on `delta > 1` therefore fires constantly on a healthy connection. This repo only flags a jump at or above `SUSPICIOUS_GAP_SLOTS` (default 5), and the report shows the raw statistics so you can pick that threshold from your own data instead of my guess.

## Run it

```bash
npm install
cp .env.example .env   # add HELIUS_API_KEY from https://dashboard.helius.dev
npm start
```

Defaults to devnet and forces one disconnect at 15 seconds, so a single run demonstrates the resume path. Override with `RUN_MS=0` to run until Ctrl-C, or `DROP_AFTER_MS=0` to measure a clean stream.

Sample output:

```
[stream] connecting: https://laserstream-devnet-ewr.helius-rpc.com
[stream] live: at live head
[demo] forcing a disconnect after 10000ms
[resume] attempt 2, resuming at slot 520778747
[stream] live: replay from 520778747
[resume] skipped ahead: asked for 520778747, first delivery was 520778757 (9 slots later)

LaserStream run summary
--------------------------------------------------------
  Wall clock                     24.0s
  Slot updates received          85
  Distinct slots                 85
  Slot window                    520778712 to 520778805
  Observed slot rate             3.54 slots/s
  Coverage of window             90.4%
  Slots not delivered            9
  Largest gap (>= 5)             9
  Suspicious gaps                1
  Reconnects                     1
  Slots lost to replay window    0
  Replay start offset(s)         9 (server started later than requested)
  Server clock lead              100ms
  Delivery excess p50            0ms
  Delivery excess p95            0ms
  Delivery samples               85
```

## How it works

Three pieces, each testable on its own.

**Plan the resume** (`src/replay-window.ts`). Before reconnecting, call `subscribeReplayInfo()` for the oldest servable slot and clamp `lastSlot + 1` against it. A `fromSlot` below the window makes the subscribe call fail with `OUT_OF_RANGE` rather than stream, so this step is what keeps a long outage recoverable instead of fatal. Slots lost to the clamp are counted, not hidden.

**Account for gaps** (`src/slot-tracker.ts`). Tracks distinct slots, span, coverage, missed slots, and the largest jump. Duplicate and out of order updates are tolerated, because LaserStream does deliver both: the probe recorded `585, 585, 586, 587, 586, 584`, which is not monotonic.

**Resume with backoff** (`src/stream.ts` + `src/backoff.ts`). Exponential delay with full jitter, capped, with a give-up threshold. `replay: false` is deliberate, and Finding 1 is what that costs: the hand-rolled resume is measurable but ineffective, because the SDK strips `fromSlot` in this mode. Run `npm run replay-mode` for the version that does recover.

## Tests

```bash
npm test
```

26 tests over the pure logic: window clamping and loss accounting, gap detection including skipped-slot behaviour, duplicate and out-of-order handling, histogram percentiles and the negative-delta case, and backoff jitter. No network required.

## Limits

Read these before quoting anything above.

- All three findings were measured on **devnet**. LaserStream mainnet requires a Business or Professional plan, so mainnet behaviour is untested here and could differ.
- Only the `ewr` region was exercised.
- `slots` subscriptions only. Whether `fromSlot` backfills transactions, accounts, or blocks is a separate question this repo does not answer.
- Devnet only, one region (`ewr`). Finding 1 is a client-side config interaction and should not be region dependent, but that is an inference rather than a measurement.
- The "skipped slots are normal" explanation is the well understood cause, but this repo measures the symptom, not the cause.

## Licence

MIT.

## Further reading

- [LaserStream gRPC quickstart](https://www.helius.dev/docs/laserstream/grpc)
- [LaserStream historical replay](https://www.helius.dev/docs/laserstream/historical-replay)
- [Yellowstone gRPC protocol reference](https://www.helius.dev/docs/laserstream)
