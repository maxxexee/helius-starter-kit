import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSignatureCache } from './dedupe'

describe('createSignatureCache', () => {
  it('reports a signature as new only once', () => {
    const cache = createSignatureCache()
    assert.equal(cache.firstSighting('sig-a'), true)
    assert.equal(cache.firstSighting('sig-a'), false)
    assert.equal(cache.size(), 1)
  })

  it('tracks distinct signatures independently', () => {
    const cache = createSignatureCache()
    assert.equal(cache.firstSighting('sig-a'), true)
    assert.equal(cache.firstSighting('sig-b'), true)
    assert.equal(cache.size(), 2)
  })

  it('never treats an empty signature as new', () => {
    const cache = createSignatureCache()
    assert.equal(cache.firstSighting(''), false)
    assert.equal(cache.size(), 0)
  })

  it('evicts the oldest entry once full', () => {
    const cache = createSignatureCache(2)
    cache.firstSighting('sig-a')
    cache.firstSighting('sig-b')
    cache.firstSighting('sig-c')
    assert.equal(cache.size(), 2)
    // sig-a was evicted, so it looks new again. This is the documented tradeoff
    // of a bounded cache: a very late duplicate can slip through.
    assert.equal(cache.firstSighting('sig-a'), true)
  })

  it('stays bounded across many deliveries', () => {
    const cache = createSignatureCache(10)
    for (let i = 0; i < 1000; i += 1) cache.firstSighting(`sig-${i}`)
    assert.equal(cache.size(), 10)
  })

  it('rejects a useless capacity', () => {
    assert.throws(() => createSignatureCache(0), RangeError)
    assert.throws(() => createSignatureCache(-1), RangeError)
    assert.throws(() => createSignatureCache(1.5), RangeError)
  })
})
