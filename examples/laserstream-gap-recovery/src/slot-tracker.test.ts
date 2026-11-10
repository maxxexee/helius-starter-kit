import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSlotTracker } from './slot-tracker'

describe('createSlotTracker', () => {
  it('reports full coverage for a contiguous run', () => {
    const tracker = createSlotTracker()
    for (const slot of [100, 101, 102, 103]) tracker.observe(slot)
    const stats = tracker.stats()
    assert.equal(stats.distinctSlots, 4)
    assert.equal(stats.span, 4)
    assert.equal(stats.coverage, 1)
    assert.equal(stats.missedSlots, 0)
    assert.equal(stats.suspiciousGaps, 0)
  })

  it('does not flag ordinary skipped slots as suspicious', () => {
    const tracker = createSlotTracker({ suspiciousGapSlots: 5 })
    for (const slot of [100, 102, 105, 106]) tracker.observe(slot)
    const stats = tracker.stats()
    assert.equal(stats.largestGap, 2)
    assert.equal(stats.suspiciousGaps, 0)
    assert.equal(tracker.gaps().length, 0)
    // 100 to 102 skips slot 101, 102 to 105 skips 103 and 104.
    assert.equal(stats.missedSlots, 3)
  })

  it('flags a jump at or above the threshold', () => {
    const tracker = createSlotTracker({ suspiciousGapSlots: 5 })
    tracker.observe(100)
    tracker.observe(140)
    const stats = tracker.stats()
    assert.equal(stats.suspiciousGaps, 1)
    assert.equal(stats.largestGap, 39)
    const [gap] = tracker.gaps()
    assert.ok(gap)
    assert.equal(gap.fromSlot, 100)
    assert.equal(gap.toSlot, 140)
    assert.equal(gap.size, 39)
  })

  it('ignores duplicate and out of order updates', () => {
    const tracker = createSlotTracker()
    for (const slot of [100, 101, 101, 100, 102]) tracker.observe(slot)
    const stats = tracker.stats()
    assert.equal(stats.updates, 5)
    assert.equal(stats.distinctSlots, 3)
    assert.equal(stats.missedSlots, 0)
  })

  it('ignores invalid slot values', () => {
    const tracker = createSlotTracker()
    tracker.observe(0)
    tracker.observe(-1)
    tracker.observe(Number.NaN)
    assert.equal(tracker.stats().updates, 0)
  })

  it('bounds retained gaps', () => {
    const tracker = createSlotTracker({ suspiciousGapSlots: 2, keepGaps: 3 })
    let slot = 0
    for (let i = 0; i < 10; i += 1) {
      slot += 10
      tracker.observe(slot)
    }
    assert.equal(tracker.gaps().length, 3)
    assert.equal(tracker.stats().suspiciousGaps, 9)
  })
})
