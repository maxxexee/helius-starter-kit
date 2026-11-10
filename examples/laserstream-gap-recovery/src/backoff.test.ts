import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backoffDelayMs } from './backoff'

const NO_JITTER = (): number => 1
const NO_DELAY = (): number => 0

describe('backoffDelayMs', () => {
  it('doubles the ceiling per attempt', () => {
    assert.equal(backoffDelayMs(1, NO_JITTER), 300)
    assert.equal(backoffDelayMs(2, NO_JITTER), 600)
    assert.equal(backoffDelayMs(3, NO_JITTER), 1200)
  })

  it('caps the ceiling', () => {
    assert.equal(backoffDelayMs(20, NO_JITTER), 8000)
  })

  it('applies full jitter across the window', () => {
    assert.equal(backoffDelayMs(3, NO_DELAY), 0)
    assert.equal(backoffDelayMs(3, () => 0.5), 600)
  })

  it('treats a non positive attempt as the first retry', () => {
    assert.equal(backoffDelayMs(0, NO_JITTER), 300)
    assert.equal(backoffDelayMs(-3, NO_JITTER), 300)
    assert.equal(backoffDelayMs(Number.NaN, NO_JITTER), 300)
  })
})
