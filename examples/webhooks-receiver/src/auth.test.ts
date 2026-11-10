import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAuthorized } from './auth'

const SECRET = 'Bearer super-secret-value'

describe('isAuthorized', () => {
  it('accepts an exact match', () => {
    assert.equal(isAuthorized(SECRET, SECRET), true)
  })

  it('rejects a different value of the same length', () => {
    assert.equal(isAuthorized('Bearer super-secret-valuX', SECRET), false)
  })

  it('rejects a value of different length', () => {
    assert.equal(isAuthorized('Bearer short', SECRET), false)
  })

  it('rejects missing headers', () => {
    assert.equal(isAuthorized(null, SECRET), false)
    assert.equal(isAuthorized(undefined, SECRET), false)
    assert.equal(isAuthorized('', SECRET), false)
  })

  it('refuses everything when no secret is configured', () => {
    // An unset environment variable must not become an open endpoint.
    assert.equal(isAuthorized('anything', ''), false)
    assert.equal(isAuthorized('', ''), false)
  })
})
