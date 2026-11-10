import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEvents } from './events'

describe('parseEvents', () => {
  it('parses a batch of events', () => {
    const body = JSON.stringify([
      { signature: 'sig-a', slot: 100, type: 'NFT_SALE' },
      { signature: 'sig-b', slot: 101, type: 'TRANSFER' },
    ])
    const result = parseEvents(body)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.events.length, 2)
    assert.equal(result.rejected, 0)
    assert.deepEqual(
      result.events.map((event) => event.signature),
      ['sig-a', 'sig-b'],
    )
  })

  it('treats a single object as invalid rather than guessing', () => {
    // Helius always sends an array. Accepting an object here would hide a real
    // change in the payload contract.
    const result = parseEvents(JSON.stringify({ signature: 'sig-a' }))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'not-array')
  })

  it('rejects a body that is not JSON', () => {
    const result = parseEvents('not json at all')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'not-json')
  })

  it('rejects malformed entries but keeps the valid ones', () => {
    const body = JSON.stringify([
      { signature: 'sig-a' },
      { slot: 10 },
      { signature: '' },
      null,
      'nope',
      { signature: 'sig-b' },
    ])
    const result = parseEvents(body)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.events.length, 2)
    assert.equal(result.rejected, 4)
  })

  it('normalises absent slot and type to null', () => {
    const result = parseEvents(JSON.stringify([{ signature: 'sig-a' }]))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const [event] = result.events
    assert.ok(event)
    assert.equal(event.slot, null)
    assert.equal(event.type, null)
  })

  it('accepts an empty batch', () => {
    const result = parseEvents('[]')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.events.length, 0)
  })
})
