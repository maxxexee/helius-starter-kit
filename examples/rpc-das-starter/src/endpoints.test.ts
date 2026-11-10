import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRpcEndpoint, isCluster, redactKey } from './endpoints'

describe('buildRpcEndpoint', () => {
  it('builds a mainnet URL containing the key', () => {
    const endpoint = buildRpcEndpoint('mainnet', 'abc123')
    assert.equal(endpoint.url, 'https://mainnet.helius-rpc.com/?api-key=abc123')
  })

  it('builds a devnet URL', () => {
    const endpoint = buildRpcEndpoint('devnet', 'abc123')
    assert.equal(endpoint.url, 'https://devnet.helius-rpc.com/?api-key=abc123')
  })

  it('never exposes the key in the redacted form', () => {
    const endpoint = buildRpcEndpoint('mainnet', 'super-secret-key')
    assert.equal(endpoint.redacted.includes('super-secret-key'), false)
    assert.equal(endpoint.redacted, 'https://mainnet.helius-rpc.com/?api-key=<redacted>')
  })

  it('percent-encodes a key with reserved characters', () => {
    const endpoint = buildRpcEndpoint('mainnet', 'a b&c')
    assert.equal(endpoint.url.endsWith('api-key=a%20b%26c'), true)
  })

  it('rejects an empty key', () => {
    assert.throws(() => buildRpcEndpoint('mainnet', '   '), /API key is empty/)
  })
})

describe('redactKey', () => {
  it('removes the key from a URL', () => {
    assert.equal(
      redactKey('https://mainnet.helius-rpc.com/?api-key=deadbeef&x=1'),
      'https://mainnet.helius-rpc.com/?api-key=<redacted>&x=1',
    )
  })

  it('leaves a URL without a key untouched', () => {
    const url = 'https://example.com/path'
    assert.equal(redactKey(url), url)
  })
})

describe('isCluster', () => {
  it('accepts the known clusters only', () => {
    assert.equal(isCluster('mainnet'), true)
    assert.equal(isCluster('devnet'), true)
    assert.equal(isCluster('testnet'), false)
    assert.equal(isCluster(''), false)
  })
})
