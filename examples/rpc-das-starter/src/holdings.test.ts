import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DasAsset } from './das'
import { summariseHoldings } from './holdings'

function asset(overrides: Partial<DasAsset> = {}): DasAsset {
  return {
    id: 'id',
    interface: 'V1_NFT',
    compressed: false,
    name: 'Some NFT',
    ...overrides,
  }
}

describe('summariseHoldings', () => {
  it('handles an empty list', () => {
    assert.deepEqual(summariseHoldings([]), {
      total: 0,
      compressed: 0,
      named: 0,
      unnamed: 0,
      byInterface: [],
    })
  })

  it('counts compressed and named assets', () => {
    const summary = summariseHoldings([
      asset({ compressed: true }),
      asset({ compressed: true, name: null }),
      asset(),
    ])
    assert.equal(summary.total, 3)
    assert.equal(summary.compressed, 2)
    assert.equal(summary.named, 2)
    assert.equal(summary.unnamed, 1)
  })

  it('groups by interface, largest first', () => {
    const summary = summariseHoldings([
      asset({ interface: 'FungibleToken' }),
      asset({ interface: 'V1_NFT' }),
      asset({ interface: 'V1_NFT' }),
    ])
    assert.deepEqual(summary.byInterface, [
      { interface: 'V1_NFT', count: 2 },
      { interface: 'FungibleToken', count: 1 },
    ])
  })

  it('breaks ties alphabetically for stable output', () => {
    const summary = summariseHoldings([
      asset({ interface: 'zeta' }),
      asset({ interface: 'alpha' }),
    ])
    assert.deepEqual(
      summary.byInterface.map((row) => row.interface),
      ['alpha', 'zeta'],
    )
  })

  it('labels a missing interface as unknown', () => {
    const summary = summariseHoldings([asset({ interface: null })])
    assert.deepEqual(summary.byInterface, [{ interface: 'unknown', count: 1 }])
  })

  it('treats an empty name as unnamed', () => {
    const summary = summariseHoldings([asset({ name: '' })])
    assert.equal(summary.unnamed, 1)
  })
})
