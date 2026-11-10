import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchAssetsByOwner } from './das'

const URL = 'https://mainnet.helius-rpc.com/?api-key=test'

function asset(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, interface: 'V1_NFT', content: { metadata: { name: `name-${id}` } }, ...extra }
}

/** Builds a fake fetch that replays the given pages in order. */
function fakeFetch(pages: unknown[][], totals: number[]): typeof fetch {
  let call = 0
  return (async () => {
    const items = pages[call] ?? []
    const total = totals[call] ?? items.length
    call += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: 'starter',
        result: { total, limit: 1000, page: call, items },
      }),
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('fetchAssetsByOwner', () => {
  it('returns assets from a single page', async () => {
    const fetchImpl = fakeFetch([[asset('a'), asset('b')]], [2])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.deepEqual(
      outcome.result.map((item) => item.id),
      ['a', 'b'],
    )
  })

  it('follows a full page until a short page arrives', async () => {
    const fetchImpl = fakeFetch([[asset('a'), asset('b')], [asset('c')]], [3, 3])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { limit: 2, fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.result.length, 3)
  })

  it('keeps paging when total under-reports the holdings', async () => {
    // Measured behaviour: total comes back equal to the page limit on every
    // page. A loop that trusts it stops after one page and silently truncates.
    const fetchImpl = fakeFetch(
      [[asset('a'), asset('b')], [asset('c'), asset('d')], [asset('e')]],
      [2, 2, 2],
    )
    const outcome = await fetchAssetsByOwner(URL, 'owner', { limit: 2, fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.result.length, 5)
  })

  it('stops on a short page', async () => {
    const fetchImpl = fakeFetch([[asset('a')]], [100])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { limit: 2, fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.result.length, 1)
  })

  it('stops at maxPages even when more exist', async () => {
    const fetchImpl = fakeFetch(
      [[asset('a')], [asset('b')], [asset('c')]],
      [3, 3, 3],
    )
    const outcome = await fetchAssetsByOwner(URL, 'owner', { limit: 1, maxPages: 2, fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.result.length, 2)
  })

  it('skips malformed items without failing the page', async () => {
    const fetchImpl = fakeFetch([[{ id: '' }, { noId: true }, asset('ok')]], [3])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.deepEqual(
      outcome.result.map((item) => item.id),
      ['ok'],
    )
  })

  it('normalises missing name and interface', async () => {
    const fetchImpl = fakeFetch([[{ id: 'bare' }]], [1])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    const [first] = outcome.result
    assert.ok(first)
    assert.equal(first.name, null)
    assert.equal(first.interface, null)
    assert.equal(first.compressed, false)
  })

  it('detects compressed assets', async () => {
    const fetchImpl = fakeFetch([[asset('c', { compression: { compressed: true } })]], [1])
    const outcome = await fetchAssetsByOwner(URL, 'owner', { fetchImpl })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.result[0]?.compressed, true)
  })
})
