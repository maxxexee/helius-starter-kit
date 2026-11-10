import { readFileSync } from 'node:fs'

/**
 * Configuration for the gap-recovery demo. Every value has a working default so
 * the repo runs with a single required variable (the API key).
 */

/** Regional endpoints. Pick the one closest to the machine that runs this. */
export const ENDPOINTS = {
  'mainnet-ewr': 'https://laserstream-mainnet-ewr.helius-rpc.com',
  'mainnet-pitt': 'https://laserstream-mainnet-pitt.helius-rpc.com',
  'mainnet-slc': 'https://laserstream-mainnet-slc.helius-rpc.com',
  'mainnet-lax': 'https://laserstream-mainnet-lax.helius-rpc.com',
  'mainnet-lon': 'https://laserstream-mainnet-lon.helius-rpc.com',
  'mainnet-ams': 'https://laserstream-mainnet-ams.helius-rpc.com',
  'mainnet-fra': 'https://laserstream-mainnet-fra.helius-rpc.com',
  'mainnet-tyo': 'https://laserstream-mainnet-tyo.helius-rpc.com',
  'mainnet-sgp': 'https://laserstream-mainnet-sgp.helius-rpc.com',
  'devnet-ewr': 'https://laserstream-devnet-ewr.helius-rpc.com',
} as const

export type EndpointName = keyof typeof ENDPOINTS

export interface DemoConfig {
  apiKey: string
  endpoint: string
  /** Jumps of at least this many slots are reported as suspicious. */
  suspiciousGapSlots: number
  /** How long to run before printing the report, in ms. 0 means run until Ctrl-C. */
  durationMs: number
  /** Force a disconnect after this long to exercise replay. 0 disables. */
  dropAfterMs: number
  /** Stop retrying after this many consecutive failed connects. */
  maxReconnectAttempts: number
}

const DEFAULT_SUSPICIOUS_GAP_SLOTS = 5
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5
/** One self-contained run: long enough to show a reconnect, short enough to watch. */
const DEFAULT_RUN_MS = 60_000
const DEFAULT_DROP_AFTER_MS = 15_000

/**
 * Minimal .env reader so the demo has no dotenv dependency. Existing process
 * environment wins, so `HELIUS_API_KEY=... npm start` overrides the file.
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return // No file is a normal case, not an error.
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key !== '' && env[key] === undefined) env[key] = value
  }
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveEndpoint(name: string | undefined): string {
  if (name === undefined || name.trim() === '') return ENDPOINTS['devnet-ewr']
  if (name.startsWith('http')) return name
  const known = ENDPOINTS[name as EndpointName]
  if (known === undefined) {
    const names = Object.keys(ENDPOINTS).join(', ')
    throw new Error(`Unknown LASERSTREAM_ENDPOINT "${name}". Use one of: ${names}, or a full URL.`)
  }
  return known
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  const apiKey = env.HELIUS_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'HELIUS_API_KEY is not set. Copy .env.example to .env and add a key from https://dashboard.helius.dev',
    )
  }
  return {
    apiKey,
    endpoint: resolveEndpoint(env.LASERSTREAM_ENDPOINT),
    suspiciousGapSlots: parseInteger(env.SUSPICIOUS_GAP_SLOTS, DEFAULT_SUSPICIOUS_GAP_SLOTS),
    durationMs: parseInteger(env.RUN_MS, DEFAULT_RUN_MS),
    dropAfterMs: parseInteger(env.DROP_AFTER_MS, DEFAULT_DROP_AFTER_MS),
    maxReconnectAttempts: parseInteger(env.MAX_RECONNECT_ATTEMPTS, DEFAULT_MAX_RECONNECT_ATTEMPTS),
  }
}
