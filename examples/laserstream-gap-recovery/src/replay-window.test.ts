import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampFromSlot, parseSlot } from './replay-window'

describe('clampFromSlot', () => {
  it('starts at the live head when no slot was requested', () => {
    assert.deepEqual(clampFromSlot(null, '1000'), {
      fromSlot: null,
      clamped: false,
      skippedSlots: 0,
    })
  })

  it('keeps a slot that is inside the window', () => {
    assert.deepEqual(clampFromSlot(5000, '1000'), {
      fromSlot: 5000,
      clamped: false,
      skippedSlots: 0,
    })
  })

  it('accepts the oldest servable slot exactly', () => {
    assert.deepEqual(clampFromSlot(1000, '1000'), {
      fromSlot: 1000,
      clamped: false,
      skippedSlots: 0,
    })
  })

  it('clamps a slot older than the window and reports the loss', () => {
    assert.deepEqual(clampFromSlot(400, '1000'), {
      fromSlot: 1000,
      clamped: true,
      skippedSlots: 600,
    })
  })

  it('falls back to the head when the endpoint offers no replay', () => {
    assert.deepEqual(clampFromSlot(400, undefined), {
      fromSlot: null,
      clamped: true,
      skippedSlots: 0,
    })
  })

  it('treats a malformed request as no replay rather than a bad fromSlot', () => {
    assert.equal(clampFromSlot(Number.NaN, '1000').fromSlot, null)
    assert.equal(clampFromSlot(-5, '1000').fromSlot, null)
  })
})

describe('parseSlot', () => {
  it('parses decimal slot strings', () => {
    assert.equal(parseSlot('123456'), 123456)
    assert.equal(parseSlot('0'), 0)
  })

  it('rejects absent and malformed values', () => {
    assert.equal(parseSlot(undefined), null)
    assert.equal(parseSlot(''), null)
    assert.equal(parseSlot('12.5'), null)
    assert.equal(parseSlot('abc'), null)
    assert.equal(parseSlot('-1'), null)
  })

  it('rejects values beyond safe integer range', () => {
    assert.equal(parseSlot('99999999999999999999'), null)
  })
})
