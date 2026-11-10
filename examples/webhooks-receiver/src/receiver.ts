import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAuthorized } from './auth'
import type { SignatureCache } from './dedupe'
import { parseEvents } from './events'
import type { HeliusEvent } from './events'

/**
 * The request handler, kept separate from server boilerplate so each decision
 * (auth, size, parse, ack, process) reads on its own.
 *
 * The ordering here is the whole point. Helius requires a 200 within one second
 * and retries anything slower or non-2xx, up to a few attempts, before dropping
 * the event. Level-triggered retries plus a slow handler is how a healthy
 * endpoint ends up with duplicates and then an automatic disable.
 */

const DEFAULT_MAX_BODY_BYTES = 1_000_000

export type ProcessEvent = (event: HeliusEvent) => Promise<void>

export interface ReceiverOptions {
  secret: string
  cache: SignatureCache
  maxBodyBytes: number
  process: ProcessEvent
  log: (line: string) => void
}

function send(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent) return
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(body)
}

/** Read the body, refusing anything over the cap before buffering it all. */
function readBody(request: IncomingMessage, capBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > capBytes) {
        resolve(null)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function runHandlers(events: HeliusEvent[], options: ReceiverOptions): Promise<void> {
  for (const event of events) {
    try {
      await options.process(event)
    } catch (error) {
      // The response is already sent, so a failure here cannot be retried by
      // Helius. Log it with the signature and let a queue or database own it.
      const message = error instanceof Error ? error.message : String(error)
      options.log(`process failed for ${event.signature}: ${message}`)
    }
  }
}

export function createHandler(options: ReceiverOptions) {
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      send(response, 405, JSON.stringify({ error: 'method not allowed' }))
      return
    }
    if (!isAuthorized(request.headers.authorization, options.secret)) {
      send(response, 401, JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const body = await readBody(request, options.maxBodyBytes)
    if (body === null) {
      send(response, 413, JSON.stringify({ error: 'payload too large' }))
      return
    }

    const parsed = parseEvents(body)
    if (!parsed.ok) {
      send(response, 400, JSON.stringify({ error: parsed.reason }))
      return
    }

    const fresh = parsed.events.filter((event) => options.cache.firstSighting(event.signature))
    // Acknowledge before doing work: the 1 second budget belongs to Helius.
    send(
      response,
      200,
      JSON.stringify({
        received: parsed.events.length,
        fresh: fresh.length,
        duplicates: parsed.events.length - fresh.length,
        rejected: parsed.rejected,
      }),
    )
    void runHandlers(fresh, options)
  }
}

export function defaultMaxBodyBytes(): number {
  return DEFAULT_MAX_BODY_BYTES
}
