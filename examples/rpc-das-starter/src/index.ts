import { fetchAssetsByOwner } from './das'
import { buildRpcEndpoint, isCluster } from './endpoints'
import type { Cluster } from './endpoints'
import { summariseHoldings } from './holdings'
import { rpcCall } from './rpc'

/**
 * Prints the SOL balance and a DAS asset summary for a wallet.
 *
 * Usage: npx tsx src/index.ts <wallet-address>
 */

const LAMPORTS_PER_SOL = 1_000_000_000

interface Config {
  apiKey: string
  cluster: Cluster
  owner: string
}

function readConfig(argv: readonly string[], env: NodeJS.ProcessEnv): Config | null {
  const owner = argv[2]?.trim()
  const apiKey = env.HELIUS_API_KEY?.trim()
  const clusterValue = env.HELIUS_CLUSTER?.trim() ?? 'mainnet'

  if (!owner) {
    console.error('Usage: npx tsx src/index.ts <wallet-address>')
    return null
  }
  if (!apiKey) {
    console.error('HELIUS_API_KEY is not set. Create one at https://dashboard.helius.dev')
    return null
  }
  if (!isCluster(clusterValue)) {
    console.error(`HELIUS_CLUSTER must be mainnet or devnet, received "${clusterValue}"`)
    return null
  }
  return { apiKey, cluster: clusterValue, owner }
}

async function balanceSol(url: string, owner: string): Promise<string> {
  const outcome = await rpcCall<{ value: number }>(url, 'getBalance', [owner])
  if (!outcome.ok) return `unavailable (${outcome.message})`
  return `${(outcome.result.value / LAMPORTS_PER_SOL).toFixed(4)} SOL`
}

async function main(): Promise<void> {
  const config = readConfig(process.argv, process.env)
  if (config === null) {
    process.exitCode = 1
    return
  }

  const endpoint = buildRpcEndpoint(config.cluster, config.apiKey)
  console.info(`cluster:  ${config.cluster}`)
  console.info(`endpoint: ${endpoint.redacted}`)
  console.info(`wallet:   ${config.owner}`)

  console.info(`balance:  ${await balanceSol(endpoint.url, config.owner)}`)

  const assets = await fetchAssetsByOwner(endpoint.url, config.owner)
  if (!assets.ok) {
    console.error(`assets:   unavailable (${assets.message})`)
    process.exitCode = 1
    return
  }

  const summary = summariseHoldings(assets.result)
  console.info(`assets:   ${summary.total} (${summary.compressed} compressed)`)
  console.info(`named:    ${summary.named}, unnamed: ${summary.unnamed}`)
  console.info('by interface:')
  for (const row of summary.byInterface) {
    console.info(`  ${row.interface.padEnd(24)} ${row.count}`)
  }
}

void main()
