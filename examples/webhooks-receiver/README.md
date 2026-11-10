# A Helius webhook receiver that survives retries

Helius webhooks are easy to demo and easy to get wrong in production. Three rules do most of the work, and getting any one of them wrong produces the same symptom: events you never see, on a webhook that looks healthy in the dashboard until it silently stops.

This receiver is about 250 lines with no runtime dependencies, and each rule has tests.

## Rule 1: acknowledge inside one second, before doing the work

Helius requires a `200` within **1 second**. Anything slower or non-2xx is treated as a failed delivery and retried a few times, then dropped. A webhook whose delivery failure rate crosses 95 percent gets automatically disabled.

The trap is that natural code structure fights this. You parse the body, you write to Postgres, you call an API, you get slow, you start returning 503 under load, and the retries make it worse.

So the handler inverts the order. Verify, parse, deduplicate, send `200`, and only then process:

```ts
const fresh = parsed.events.filter((event) => options.cache.firstSighting(event.signature))
send(response, 200, JSON.stringify({ received, fresh, duplicates, rejected }))
void runHandlers(fresh, options)
```

Processing failures after the acknowledgement cannot be retried by Helius, because you already told it the delivery succeeded. That is the correct tradeoff, but it means you own delivery to whatever actually does the work. Log the signature and hand off to a queue or database. Do not swallow it.

## Rule 2: verify the Authorization header, and fail closed

You set `authHeader` when creating the webhook. Helius echoes that exact value in the `Authorization` header on every delivery. Without the check, anyone who learns your URL can post fabricated onchain events.

Two details matter more than the comparison itself:

```ts
if (expected === '') return false
```

If the secret is unset, reject everything. The tempting version, where an empty expected value makes every request pass, turns one missing environment variable in one deploy into a public endpoint that accepts forged events.

```ts
return timingSafeEqual(given, secret)
```

Constant-time comparison, so a wrong guess cannot be refined byte by byte from response latency.

## Rule 3: deduplicate, because retries are not new events

Helius retries a delivery when your endpoint returns 5xx, a 4xx other than 403, times out, or fails at the connection level. The retried payload is the same event. If your handler moves funds, sends a notification, or inserts a row, a duplicate is a real bug.

The idempotency key is the transaction `signature`. This receiver keeps a bounded set of seen signatures and drops repeats:

```
first delivery   {"received":2,"fresh":2,"duplicates":0,"rejected":0}
retry of same    {"received":2,"fresh":0,"duplicates":2,"rejected":0}
```

Both of those are real responses from a local run of this code.

The set is capped at 5000 entries and evicts in insertion order, so memory stays flat on a long-running process. That is a deliberate tradeoff: a duplicate arriving after 5000 newer signatures will get through. Persisting signatures in Redis or a unique index on the table is the durable version.

## One more thing people miss: the payload is an array

Helius always posts a JSON array, even for a single event. Code written against an object works in testing, then breaks the first time two transactions confirm in the same batch. `parseEvents` returns `not-array` for an object rather than quietly accepting both shapes, so a change in the contract shows up as an error instead of a mystery.

Malformed entries are counted and skipped rather than failing the batch. One bad entry should not cost you the other four.

## Run it

```bash
npm install
HELIUS_WEBHOOK_SECRET='Bearer your-secret' npm start
```

Helius cannot reach `localhost`, so expose the port:

```bash
cloudflared tunnel --url http://localhost:8787
```

Then create a webhook at [dashboard.helius.dev](https://dashboard.helius.dev) pointing at the tunnel URL, with `authHeader` set to the same `Bearer your-secret` value.

Smoke test without Helius:

```bash
curl -i -X POST http://localhost:8787/ \
  -H 'Authorization: Bearer your-secret' \
  -H 'content-type: application/json' \
  -d '[{"signature":"sig-a","slot":100,"type":"NFT_SALE"}]'
```

Verified responses from a local run:

| Request | Status |
|---|---|
| No `Authorization` header | 401 |
| Wrong secret | 401 |
| Valid batch | 200, `{"received":2,"fresh":2,...}` |
| Same batch again | 200, `{"received":2,"fresh":0,"duplicates":2}` |
| Body is not JSON | 400 |
| `GET /` | 405 |

## Tests

```bash
npm test
```

17 tests over auth, dedupe, and payload parsing. No network required.

## Limits

- The seen-signature cache is in process memory. It does not survive a restart and is not shared between instances. For anything that matters, make the sink idempotent (unique constraint on signature) instead of relying on this.
- `400` on a malformed body is correct, but note that Helius retries 4xx responses. A permanently malformed payload would be retried a few times before being dropped.
- Ordering is not guaranteed and is not preserved here. Events are processed as they arrive.
