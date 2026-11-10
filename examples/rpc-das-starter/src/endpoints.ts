/**
 * Helius endpoint construction.
 *
 * Every Helius URL carries the API key as a query parameter, which is why these
 * strings must never be logged as-is or committed. `redactKey` exists for that.
 */

export type Cluster = 'mainnet' | 'devnet'

const RPC_HOSTS: Record<Cluster, string> = {
  mainnet: 'https://mainnet.helius-rpc.com',
  devnet: 'https://devnet.helius-rpc.com',
}

export interface RpcEndpoint {
  url: string
  /** URL safe to print or log, with the key removed. */
  redacted: string
}

export function buildRpcEndpoint(cluster: Cluster, apiKey: string): RpcEndpoint {
  if (apiKey.trim() === '') {
    throw new Error('API key is empty. Create one at https://dashboard.helius.dev')
  }
  const host = RPC_HOSTS[cluster]
  const url = `${host}/?api-key=${encodeURIComponent(apiKey)}`
  return { url, redacted: `${host}/?api-key=<redacted>` }
}

/** Strip a key from an arbitrary Helius URL, for logs and error messages. */
export function redactKey(url: string): string {
  return url.replace(/api-key=[^&]+/g, 'api-key=<redacted>')
}

export function isCluster(value: string): value is Cluster {
  return value === 'mainnet' || value === 'devnet'
}
