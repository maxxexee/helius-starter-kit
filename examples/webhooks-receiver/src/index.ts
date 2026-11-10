import { createServer } from 'node:http'
import { createSignatureCache } from './dedupe'
import type { HeliusEvent } from './events'
import { createHandler, defaultMaxBodyBytes } from './receiver'

/**
 * Minimal Helius webhook receiver.
 *
 * Point a webhook at this process through a tunnel (Helius cannot reach
 * localhost) and it will verify, deduplicate, acknowledge, and process.
 */

const DEFAULT_PORT = 8787

interface Config {
  secret: string
  port: number
  maxBodyBytes: number
}

function readConfig(env: NodeJS.ProcessEnv): Config | null {
  const secret = env.HELIUS_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error(
      'HELIUS_WEBHOOK_SECRET is not set. It must match the authHeader on the webhook ' +
        'you created at https://dashboard.helius.dev',
    )
    return null
  }
  const port = Number(env.PORT ?? DEFAULT_PORT)
  const maxBodyBytes = Number(env.MAX_BODY_BYTES ?? defaultMaxBodyBytes())
  return {
    secret,
    port: Number.isSafeInteger(port) && port > 0 ? port : DEFAULT_PORT,
    maxBodyBytes: Number.isSafeInteger(maxBodyBytes) && maxBodyBytes > 0 ? maxBodyBytes : defaultMaxBodyBytes(),
  }
}

/** Stand-in for real work. Replace with your database, queue, or alerting. */
async function processEvent(event: HeliusEvent): Promise<void> {
  console.info(`[event] ${event.type ?? 'unknown'} ${event.signature} slot=${event.slot ?? '?'}`)
}

function main(): void {
  const config = readConfig(process.env)
  if (config === null) {
    process.exitCode = 1
    return
  }

  const cache = createSignatureCache()
  const handler = createHandler({
    secret: config.secret,
    cache,
    maxBodyBytes: config.maxBodyBytes,
    process: processEvent,
    log: (line) => console.warn(line),
  })

  const server = createServer((request, response) => {
    handler(request, response).catch((error: unknown) => {
      console.error('handler failed:', error instanceof Error ? error.message : String(error))
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })

  server.listen(config.port, () => {
    console.info(`listening on http://localhost:${config.port} (POST /)`)
    console.info('expose it with: cloudflared tunnel --url http://localhost:' + config.port)
  })

  const shutdown = (): void => {
    console.info('shutting down')
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
