import { startTransition, useEffect, useState } from "react"

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  /** Public group label added in hub 1.3.0. */
  group?: string
  last_seen: number
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  /** Remaining calendar days as counted by the hub; absent on older versions. */
  expires_in?: number | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  /** This period's usage as the plan meters it (`traffic_mode`). Absent on older hubs. */
  month_used?: number
  month_start: string
  day_rx: number
  day_tx: number
  /** Panel only. */
  hostname?: string
  ip?: string
  remark?: string
}

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

const METRIC_FIELDS = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
  "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
const nonnegativeNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0

/** A malformed report must not remove every other node from the page. */
export function safeNodes(nodes: unknown): Node[] {
  if (!Array.isArray(nodes)) throw new Error("节点数据格式异常")
  return nodes.filter((node): node is Node => node !== null && typeof node === "object" && Number.isSafeInteger(node.id)).map((node) => {
    const m = node.metrics
    return m == null || (METRIC_FIELDS.every((key) => nonnegativeNumber(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(nonnegativeNumber))
      ? node : { ...node, metrics: null }
  })
}

/** Keep unchanged rows stable across JSON snapshots so memoized rows can skip a paint. */
export function shareNodes(previous: Node[] | null, incoming: Node[]): Node[] {
  if (!previous) return incoming
  const byId = new Map(previous.map((node) => [node.id, node]))
  const next = incoming.map((node) => {
    const old = byId.get(node.id)
    if (!old) return node
    const a = old.metrics
    const b = node.metrics
    const sameMetrics = a === b || (a != null && b != null && METRIC_FIELDS.every((key) => a[key] === b[key]) && a.load.every((value, i) => value === b.load[i]))
    const keys = Object.keys(node) as (keyof Node)[]
    if (sameMetrics && keys.length === Object.keys(old).length && keys.every((key) => key === "metrics" || old[key] === node[key])) return old
    return sameMetrics && a !== b ? { ...node, metrics: a } : node
  })
  return next.length === previous.length && next.every((node, i) => node === previous[i]) ? previous : next
}

type NodeObserver = {
  onNodes: (nodes: Node[]) => void
  onError: (error: Error) => void
}

/**
 * One live subscription, with a single in-flight fallback request. A stream
 * snapshot wins over an earlier HTTP request, even if its abort arrives late.
 */
export function subscribeNodes({ onNodes, onError }: NodeObserver) {
  let socket: WebSocket | null = null
  let poll: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let request: AbortController | null = null
  let polling = false
  let pollGeneration = 0
  let disposed = false
  let streamRevision = 0

  const fetchOnce = async () => {
    if (disposed || request) return
    const controller = new AbortController()
    const revision = streamRevision
    request = controller
    try {
      const data = await api<{ nodes: unknown }>("/nodes", { signal: controller.signal })
      if (!disposed && !controller.signal.aborted && revision === streamRevision) onNodes(safeNodes(data?.nodes))
    } catch (error) {
      if (!disposed && !controller.signal.aborted && revision === streamRevision) onError(error instanceof Error ? error : new Error("网络错误"))
    } finally {
      if (request === controller) request = null
    }
  }

  const pollOnce = () => {
    poll = null
    const generation = pollGeneration
    void fetchOnce().finally(() => {
      if (polling && !disposed && generation === pollGeneration) poll = setTimeout(pollOnce, 5000)
    })
  }
  const startPolling = () => {
    if (!polling && !disposed) {
      polling = true
      poll = setTimeout(pollOnce, 5000)
    }
  }
  const stopPolling = () => {
    polling = false
    pollGeneration++
    if (poll) clearTimeout(poll)
    poll = null
  }

  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`
  const reconnect = () => {
    if (!disposed && !retry) retry = setTimeout(() => { retry = null; connect() }, 5000)
  }
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
  }
  const armWatchdog = (current: WebSocket) => {
    clearWatchdog()
    // A connection can remain open yet stop reporting. Recover through the
    // existing HTTP fallback, then reconnect instead of showing frozen metrics.
    watchdog = setTimeout(() => {
      watchdog = null
      if (disposed || socket !== current) return
      socket = null
      current.onmessage = current.onerror = current.onclose = null
      try { current.close() } catch { /* A pending handshake may reject close(). */ }
      startPolling()
      reconnect()
    }, 30000)
  }
  const connect = () => {
    if (disposed) return
    let current: WebSocket
    try {
      current = new WebSocket(url)
      socket = current
      armWatchdog(current)
    } catch {
      startPolling()
      reconnect()
      return
    }
    current.onmessage = (event) => {
      if (disposed || socket !== current) return
      let next: Node[]
      try {
        next = safeNodes(JSON.parse(event.data)?.nodes)
      } catch {
        onError(new Error("实时数据格式异常，正在重新连接"))
        current.close()
        return
      }
      streamRevision++
      request?.abort()
      request = null
      onNodes(next)
      stopPolling()
      armWatchdog(current)
    }
    current.onerror = () => current.close()
    current.onclose = () => {
      if (disposed || socket !== current) return
      clearWatchdog()
      socket = null
      startPolling()
      reconnect()
    }
  }

  void fetchOnce()
  connect()
  return () => {
    disposed = true
    clearWatchdog()
    stopPolling()
    if (retry) clearTimeout(retry)
    request?.abort()
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null
      socket.close()
    }
  }
}

/** Live node list, preferring the hub's two-second WebSocket snapshots. */
export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A 401 means the status page was closed to anonymous callers after loading.
  const [closed, setClosed] = useState(false)

  useEffect(() => subscribeNodes({
    onNodes: (next) => {
      // Let taps and scrolling win over the recurring telemetry paints.
      startTransition(() => setNodes((previous) => shareNodes(previous, next)))
      setError(null)
      setClosed(false)
    },
    onError: (error) => {
      setError(error.message || "网络错误")
      if (error instanceof ApiError && error.status === 401) setClosed(true)
    },
  }), [])

  return { nodes, error, closed }
}
