# Helius starter kit

Three small, runnable examples for the Helius data platform. Each one exists to document a behaviour that is easy to assume and wrong to assume, with the measurements that show it.

Everything here was run against live Helius endpoints. Every number in these READMEs came out of a terminal, not out of a doc page.

## Examples

### [LaserStream gap recovery](examples/laserstream-gap-recovery)

Measure what a reconnect actually recovers instead of assuming it recovered everything.

Findings:
- `fromSlot` does not backfill `slots` subscription updates. The request is accepted and the stream starts at the live head, so the missed slot updates are gone with no error. Reproduced across three runs on devnet, offsets of 6 to 9 slots.
- `Date.now() - update.createdAt` is negative on this endpoint, because the server clock leads a typical machine. Latency code that filters negatives reports zero samples forever while looking healthy.
- Healthy slot streams are 90 to 94 percent contiguous. Skipped slots mean a `delta > 1` gap detector fires constantly on a connection that never dropped.

### [Webhooks receiver](examples/webhooks-receiver)

The three rules that decide whether your webhook works, with tests: acknowledge inside the one second budget before processing, verify the `Authorization` header and fail closed when the secret is unset, and deduplicate on transaction signature because retries are not new events.

### [RPC and DAS starter](examples/rpc-das-starter)

`getAssetsByOwner` with no SDK, and the pagination trap inside it.

Finding: `total` reports the page limit, not the holdings. Measured on mainnet, three pages returned 3000 distinct assets while `total` said 1000 every time. A loop that terminates on `total` silently truncates. The same wallet reported 1000 assets before the fix and 5360 after.

## Running any example

Each directory is standalone.

```bash
cd examples/<name>
npm install
cp .env.example .env
npm test
npm start
```

Node 20 or newer. No runtime dependencies in the webhook and RPC examples; the LaserStream example uses `helius-laserstream` only.

## Testing

```bash
cd examples/laserstream-gap-recovery && npm test && npm run typecheck
cd examples/webhooks-receiver && npm test && npm run typecheck
cd examples/rpc-das-starter && npm test && npm run typecheck
```

65 tests total. All pure logic, no network required.

## Nothing here is production infrastructure

These are teaching examples with a narrow happy path and clearly listed limits in each README. In particular: the signature cache is in process memory, the DAS client has no retry or rate limit handling, and everything LaserStream-related was measured on devnet because mainnet access needs a Business or Professional plan.

## Licence

MIT.
