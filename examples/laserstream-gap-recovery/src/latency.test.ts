import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLatencyHistogram } from './latency'

describe('createLatencyHistogram', () => {
  it('returns nulls with no samples', () => {
    const summary = createLatencyHistogram().summary()
    assert.deepEqual(summary, {
      samples: 0,
      floorMs: null,
      clockLeadMs: null,
      excessP50Ms: null,
      excessP95Ms: null,
      excessP99Ms: null,
      sawOverflow: false,
    })
  })

  it('keeps negative deltas instead of discarding them', () => {
    const histogram = createLatencyHistogram()
    // Server clock leads this machine by about a second.
    histogram.observeSince(new Date(10_000), 9_000)
    const summary = histogram.summary()
    assert.equal(summary.samples, 1)
    assert.equal(summary.floorMs, -1000)
    assert.equal(summary.clockLeadMs, 1000)
  })

  it('measures excess above the floor, ignoring constant skew', () => {
    const histogram = createLatencyHistogram()
    for (const delta of [-1000, -1000, -1000, -750]) histogram.observe(delta)
    const summary = histogram.summary()
    assert.equal(summary.floorMs, -1000)
    assert.equal(summary.excessP50Ms, 0)
    // -750 reports as its bucket ceiling of -500, so the excess rounds up to
    // the bucket resolution rather than the exact 250.
    assert.equal(summary.excessP95Ms, 500)
  })

  it('reports zero excess for identical samples', () => {
    const histogram = createLatencyHistogram()
    for (let i = 0; i < 4; i += 1) histogram.observe(42)
    assert.equal(histogram.summary().excessP50Ms, 0)
  })

  it('flags values outside the bounded range', () => {
    const histogram = createLatencyHistogram()
    histogram.observe(999_999)
    assert.equal(histogram.summary().sawOverflow, true)
  })

  it('ignores non finite samples', () => {
    const histogram = createLatencyHistogram()
    histogram.observe(Number.NaN)
    histogram.observe(Number.POSITIVE_INFINITY)
    assert.equal(histogram.summary().samples, 0)
  })

  it('skips missing stamps', () => {
    const histogram = createLatencyHistogram()
    histogram.observeSince(null, 1000)
    histogram.observeSince(undefined, 1000)
    assert.equal(histogram.summary().samples, 0)
  })
})
