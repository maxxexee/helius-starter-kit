import { redactKey } from './endpoints'

/**
 * Minimal JSON-RPC client over fetch.
 *
 * No SDK on purpose: the DAS API is plain JSON-RPC, so the whole contract is
 * visible in a handful of lines and nothing hides the request or the error shape.
 */

export type RpcOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'json'; message: string }
  | { ok: false; kind: 'rpc'; code: number; message: string }

interface RpcEnvelope<T> {
  jsonrpc?: string
  id?: string | number
  result?: T
  error?: { code?: number; message?: string }
}

const REQUEST_TIMEOUT_MS = 15_000

function decodeEnvelope<T>(method: string, envelope: RpcEnvelope<T>): RpcOutcome<T> {
  if (envelope.error !== undefined) {
    return {
      ok: false,
      kind: 'rpc',
      code: envelope.error.code ?? 0,
      message: envelope.error.message ?? 'unknown RPC error',
    }
  }
  if (envelope.result === undefined) {
    return { ok: false, kind: 'rpc', code: 0, message: `${method}: no result in response` }
  }
  return { ok: true, result: envelope.result }
}

export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<RpcOutcome<T>> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'starter', method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: 'network', message: `${method}: ${message}` }
  }

  if (!response.ok) {
    const message = `${method}: HTTP ${response.status} from ${redactKey(url)}`
    return { ok: false, kind: 'network', message }
  }

  try {
    return decodeEnvelope(method, (await response.json()) as RpcEnvelope<T>)
  } catch {
    return { ok: false, kind: 'json', message: `${method}: response was not JSON` }
  }
}
