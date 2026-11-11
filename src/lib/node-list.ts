import type { Node } from "./api.ts"
import { daysUntil, monthUsage, percent } from "./format.ts"

export type NodeStatusFilter = "all" | "online" | "offline" | "attention"
export type NodeSortKey = "default" | "name" | "cpu" | "memory" | "traffic" | "network"
export type NodeListPreferences = {
  status: NodeStatusFilter
  sort: NodeSortKey
  direction: "asc" | "desc"
}

export const DEFAULT_LIST_PREFERENCES: NodeListPreferences = { status: "all", sort: "default", direction: "asc" }
export const LIST_PREFERENCES_KEY = "monitor-glass:node-list:v1"

/** Persist choices, never a search query or server data. Storage may be blocked. */
export function readListPreferences(storage?: Pick<Storage, "getItem">): NodeListPreferences {
  try {
    const raw = (storage ?? window.localStorage).getItem(LIST_PREFERENCES_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return { ...DEFAULT_LIST_PREFERENCES }
    const saved = value as Record<string, unknown>
    return {
      status: typeof saved.status === "string" && ["all", "online", "offline", "attention"].includes(saved.status) ? saved.status as NodeStatusFilter : "all",
      sort: typeof saved.sort === "string" && ["default", "name", "cpu", "memory", "traffic", "network"].includes(saved.sort) ? saved.sort as NodeSortKey : "default",
      direction: saved.direction === "desc" ? "desc" : "asc",
    }
  } catch {
    return { ...DEFAULT_LIST_PREFERENCES }
  }
}

export function saveListPreferences(preferences: NodeListPreferences, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? window.localStorage).setItem(LIST_PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }))
  } catch {
    // A disabled or full storage must not interrupt the live list.
  }
}

/** Same resource thresholds as the red meters; offline and missing reports need attention too. */
export function needsAttention(node: Node) {
  const metrics = node.metrics
  return !node.online || !metrics || metrics.cpu >= 90
    || percent(metrics.mem_used, metrics.mem_total) >= 90
    || percent(metrics.disk_used, metrics.disk_total) >= 90
    || (node.traffic_limit > 0 && monthUsage(node) >= node.traffic_limit)
}

const regionNames = [new Intl.DisplayNames(["zh-CN"], { type: "region" }), new Intl.DisplayNames(["en"], { type: "region" })]
const countryCache = new Map<string, string>()

function countryTerms(country: string) {
  const code = country.toUpperCase()
  if (countryCache.has(code)) return countryCache.get(code)!
  let names = code
  if (/^[A-Z]{2}$/.test(code)) names += " " + regionNames.map((regions) => regions.of(code) ?? "").join(" ")
  countryCache.set(code, names)
  return names
}

/** Only public fields: panel-only hostname, IP and remarks cannot become search hints. */
function searchText(node: Node) {
  return [node.name, node.group, countryTerms(node.country), node.os, node.kernel, node.arch, node.virt, node.cpu_name]
    .join(" ").toLocaleLowerCase()
}

const nameOrder = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

function metricValue(node: Node, sort: NodeSortKey): number | null {
  if (sort === "traffic") return monthUsage(node)
  if (!node.online || !node.metrics) return null
  if (sort === "cpu") return node.metrics.cpu
  if (sort === "memory") return node.metrics.mem_total > 0 ? percent(node.metrics.mem_used, node.metrics.mem_total) : null
  if (sort === "network") return node.metrics.net_rx + node.metrics.net_tx
  return null
}

/** Keep the source array untouched and equal values in administrator order on every update. */
export function selectNodes(nodes: readonly Node[], query: string, preferences: NodeListPreferences): Node[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const selected = nodes.filter((node) => {
    if (preferences.status === "online" && !node.online) return false
    if (preferences.status === "offline" && node.online) return false
    if (preferences.status === "attention" && !needsAttention(node)) return false
    if (!terms.length) return true
    const text = searchText(node)
    return terms.every((term) => text.includes(term))
  })
  const direction = preferences.direction === "desc" ? -1 : 1
  return selected.sort((a, b) => {
    const fallback = a.sort - b.sort || a.id - b.id
    if (preferences.sort === "default") return direction * fallback
    if (preferences.sort === "name") return direction * nameOrder.compare(a.name, b.name) || fallback
    const av = metricValue(a, preferences.sort)
    const bv = metricValue(b, preferences.sort)
    // Missing telemetry belongs at the end in either direction, never among real zeroes.
    if (av === null || bv === null) return av === bv ? fallback : av === null ? 1 : -1
    return direction * (av - bv) || fallback
  })
}

/** Group labels in administrator order, each once; nodes without a label belong to none. */
export function nodeGroups(nodes: readonly Node[]): string[] {
  const ordered = [...nodes].sort((a, b) => a.sort - b.sort || a.id - b.id)
  return [...new Set(ordered.map((node) => node.group?.trim() ?? "").filter(Boolean))]
}

/** The chosen group's nodes, or all of them when none is chosen. */
export function inGroup(nodes: readonly Node[], group: string | null): readonly Node[] {
  return group === null ? nodes : nodes.filter((node) => (node.group?.trim() ?? "") === group)
}

/**
 * A renewal date close enough to act on: within a week, or already past. The
 * hub's own count of days is preferred, since it is taken on the hub's calendar.
 */
export function expiryNotice(node: Pick<Node, "expires_at" | "expires_in">): { label: string; short: string; level: "warn" | "danger" } | null {
  if (!node.expires_at) return null
  const days = typeof node.expires_in === "number" && Number.isFinite(node.expires_in) ? node.expires_in : daysUntil(node.expires_at)
  if (days === null || days > 7) return null
  // `short` is for a phone's name column, which has room for two characters.
  if (days < 0) return { label: "已过期", short: "过期", level: "danger" }
  if (days === 0) return { label: "今天到期", short: "今天", level: "danger" }
  return { label: `${days} 天到期`, short: `${days}天`, level: days <= 3 ? "danger" : "warn" }
}
