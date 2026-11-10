# Helius RPC and DAS starter, and the pagination bug that hides in it

No SDK, no dependencies. Two things this repo demonstrates: how little code a Helius RPC call actually needs, and a pagination trap that silently drops most of a wallet's assets while every response looks successful.

```bash
npm install
HELIUS_API_KEY=your-key npx tsx src/index.ts H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS
```

```
cluster:  mainnet
endpoint: https://mainnet.helius-rpc.com/?api-key=<redacted>
wallet:   H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS
balance:  92778.7642 SOL
assets:   5360 (4298 compressed)
named:    5107, unnamed: 253
by interface:
  V1_NFT                   4297
  FungibleToken            881
  FungibleAsset            114
  Custom                   35
  MplBubblegumV2            27
  MplCoreAsset               3
  ProgrammableNFT            3
```

## The trap: `total` does not mean total

`getAssetsByOwner` returns a `total` field, and the obvious pagination loop is:

```ts
if (collected.length >= page.total) break
```

That loop is wrong. Measured on mainnet against a large wallet, with `limit: 1000`:

| Page | `total` reported | Items returned | First asset id |
|---|---|---|---|
| 1 | 1000 | 1000 | `JEGs95Zm1ArgfeZ6hseNyZ49sd4eWDe2XUdJLkUMauSb` |
| 2 | 1000 | 1000 | `Ek944jnyDPUMpxprUG84DPU55knbCXtT17THGYD71twX` |
| 3 | 1000 | 1000 | `BQuvt7SvomSW11QHXKevLPRHaSkjRKH9mEDP9vHtgRpz` |

3000 items across the three pages, 3000 distinct ids, zero overlap. `total` reported 1000 every single time. It is echoing the page limit, not the holdings.

So a total-based loop stops after page 1 having collected exactly `limit` items, and the result is a portfolio that is missing 81 percent of its assets with no error anywhere. My own first version of this file had that bug, and the run above reported `assets: 1000` because of it. After removing the `total` check and terminating on a short page instead, the same wallet returned `5360`.

The only reliable terminator is a page shorter than `limit`:

```ts
if (items.length < limit) break
```

Keep a `maxPages` guard as well, so a wallet with a very large holding cannot loop forever.

## Why no SDK

The DAS API is plain JSON-RPC over the same endpoint as everything else. Skipping the SDK keeps the request, the response envelope, and the error shape all visible in `src/rpc.ts`, which makes it a better thing to read when you are debugging your own integration. If you would rather use the SDK, the connection swap is one line:

```ts
import { Connection } from '@solana/web3.js'
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`)
```

Everything downstream of that `Connection` keeps working. Helius is drop-in compatible with standard Solana JSON-RPC.

## What is in here

| File | Purpose |
|---|---|
| `src/endpoints.ts` | URL construction and a `redactKey` helper, because the API key lives in the URL and must never reach a log |
| `src/rpc.ts` | Typed JSON-RPC caller with a discriminated outcome: network, JSON, or RPC error |
| `src/das.ts` | `getAssetsByOwner` with correct pagination, bounded by `maxPages` |
| `src/holdings.ts` | Pure summary counts by interface, sorted for stable output |
| `src/index.ts` | CLI: balance plus asset summary |

Errors are values, not exceptions. `rpcCall` returns a union of success, network failure, malformed JSON, and RPC-level error, so the caller has to decide what to show instead of getting an unhandled rejection.

## Tests

```bash
npm test
```

22 tests. The pagination tests use a fake `fetch`, so they cover the lying-`total` case, short pages, malformed items, and the `maxPages` guard without touching the network.

## Limits

- Verified on mainnet only, and only against wallets small enough to finish in 10 pages.
- `maxPages` defaults to 10, so 10,000 assets. Raise it for very large holders, and expect the request volume that implies.
- Compressed assets are counted and reported but not expanded. `getAssetsByOwner` returns compressed NFTs alongside the rest, so a holding count that ignores them understates a Bubblegum-heavy wallet significantly, which the 4298 compressed assets above show.
- No retry or rate-limit handling. A real client should back off on 429.
