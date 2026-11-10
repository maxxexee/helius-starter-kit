import type { RpcOutcome } from './rpc'
import { rpcCall } from './rpc'

/**
 * `getAssetsByOwner` with pagination.
 *
 * The DAS API pages at 1000 items by default. A wallet holding more than that
 * returns a partial list with no error, so pagination is not optional: it is the
 * difference between a correct portfolio and one that silently drops assets.
 *
 * The obvious loop terminates when `collected >= total`. Do not do that. Measured
 * on mainnet, `total` comes back equal to the page limit on every page, so it
 * reports 1000 for a wallet that returns 1000 items on page 1, 1000 more on page
 * 2, and 1000 more on page 3, all distinct. A total-based loop stops after one
 * page and looks correct while dropping two thirds of the holdings.
 *
 * The only reliable terminator is a page shorter than `limit`.
 */

export interface DasAsset {
  id: string
  interface: string | null
  compressed: boolean
  name: string | null
}

interface RawAsset {
  id?: unknown
  interface?: unknown
  compression?: { compressed?: unknown }
  content?: { metadata?: { name?: unknown } }
  token_info?: { balance?: unknown; decimals?: unknown }
}

interface RawAssetPage {
  total?: unknown
  limit?: unknown
  page?: unknown
  items?: unknown
}

export interface FetchAssetsOptions {
  limit: number
  maxPages: number
  fetchImpl?: typeof fetch
}

const DEFAULT_LIMIT = 1000
const DEFAULT_MAX_PAGES = 10

function toAsset(raw: RawAsset): DasAsset | null {
  if (typeof raw.id !== 'string' || raw.id === '') return null
  const name = raw.content?.metadata?.name
  return {
    id: raw.id,
    interface: typeof raw.interface === 'string' ? raw.interface : null,
    compressed: raw.compression?.compressed === true,
    name: typeof name === 'string' ? name : null,
  }
}

function toItems(rawPage: RawAssetPage): DasAsset[] {
  if (!Array.isArray(rawPage.items)) return []
  const assets: DasAsset[] = []
  for (const item of rawPage.items) {
    if (typeof item !== 'object' || item === null) continue
    const asset = toAsset(item as RawAsset)
    if (asset !== null) assets.push(asset)
  }
  return assets
}  /** True when another page is worth requesting. Never trusts `total`. */
function shouldFetchAnotherPage(input: {
  received: number
  limit: number
  page: number
  maxPages: number
}): boolean {
  if (input.received < input.limit) return false
  if (input.page >= input.maxPages) return false
  return true
}

export async function fetchAssetsByOwner(
  url: string,
  ownerAddress: string,
  options: Partial<FetchAssetsOptions> = {},
): Promise<RpcOutcome<DasAsset[]>> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const collected: DasAsset[] = []

  for (let page = 1; page <= maxPages; page += 1) {
    const outcome = await rpcCall<RawAssetPage>(
      url,
      'getAssetsByOwner',
      { ownerAddress, page, limit, displayOptions: { showFungible: true } },
      options.fetchImpl,
    )
    if (!outcome.ok) return outcome

    const items = toItems(outcome.result)
    collected.push(...items)
    const more = shouldFetchAnotherPage({ received: items.length, limit, page, maxPages })
    if (!more) return { ok: true, result: collected }
  }
  return { ok: true, result: collected }
}
