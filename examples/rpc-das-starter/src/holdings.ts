import type { DasAsset } from './das'

/**
 * Pure summaries over a DAS asset list, kept out of the CLI so they can be
 * tested without a network.
 */

export interface HoldingSummary {
  total: number
  compressed: number
  named: number
  unnamed: number
  byInterface: Array<{ interface: string; count: number }>
}

/** Counts by interface, largest first, ties broken alphabetically for stable output. */
export function summariseHoldings(assets: readonly DasAsset[]): HoldingSummary {
  const counts = new Map<string, number>()
  let compressed = 0
  let named = 0

  for (const asset of assets) {
    if (asset.compressed) compressed += 1
    if (asset.name !== null && asset.name !== '') named += 1
    const key = asset.interface ?? 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const byInterface = [...counts.entries()]
    .map(([interfaceName, count]) => ({ interface: interfaceName, count }))
    .sort((a, b) => b.count - a.count || a.interface.localeCompare(b.interface))

  return {
    total: assets.length,
    compressed,
    named,
    unnamed: assets.length - named,
    byInterface,
  }
}
