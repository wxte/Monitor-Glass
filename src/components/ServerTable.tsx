import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, ArrowUp, Database, Network, Search, Server, X } from "lucide-react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Skeleton } from "@/components/ui/skeleton"
import type { Node } from "@/lib/api"
import {
  bytes, compact, CYCLES, daysUntil, distro, FOREVER, money, monthUsage, osName, cpuName, pair,
  percent, rate, uptime,
} from "@/lib/format"
import { Link } from "@/lib/route"
import { needsAttention, readListPreferences, saveListPreferences, selectNodes, type NodeSortKey, type NodeStatusFilter } from "@/lib/node-list"
import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 271. vite.config.ts keeps the small ones from being
// inlined into the bundle as data URLs.
const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

const Latency = lazy(() => import("@/components/NodeDetail").then((m) => ({ default: m.Latency })))

/** A node that has reported once knows its shape; one that never connected has nothing to show. */
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Dot({ node, className }: { node: Node; className?: string }) {
  const state = node.online ? "online" : deployed(node) ? "offline" : "pending"
  return (
    <span
      title={state === "online" ? "在线" : state === "offline" ? "离线" : "未接入"}
      data-status={state}
      className={cn("status-dot relative inline-block size-4 shrink-0 align-middle", className)}
    >
      {node.online && <span aria-hidden="true" className="status-dot-pulse absolute rounded-full" />}
      <span aria-hidden="true" className="status-dot-halo absolute inset-0 rounded-full" />
      <span aria-hidden="true" className="status-dot-core absolute rounded-full" />
    </span>
  )
}

export function Flag({ code, className }: { code: string; className?: string }) {
  if (!code) return <span className="text-muted-foreground">—</span>
  const src = FLAGS[code.toLowerCase()]
  return (
    <span className={cn("inline-flex items-center justify-center gap-1", className)}>
      {src && <img src={src} alt="" className="h-3 w-4 shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/10" />}
      <span className="@max-3xl:hidden">{code}</span>
    </span>
  )
}

// Matched against the whole release name, since "Red Hat Enterprise Linux" and
// "Raspbian GNU/Linux" do not lead with one word to key on. The distributions a
// VPS ships with; the rest take the penguin. Each logo costs 1-6 KB of entry
// bundle, the Raspberry Pi alone 12 KB, so the list stays at what hosts offer.
const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/**
 * The distribution's logo in its brand colour. Mixed toward white on the dark
 * theme, where AlmaLinux's black and CentOS's navy would otherwise vanish.
 */
export function OsIcon({ os, className }: { os: string; className?: string }) {
  if (!os) return null
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className={cn("size-3.5 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]", className)}
    >
      <path d={icon.path} />
    </svg>
  )
}


const SLOT = { compact: 5.6, bytes: 7.3, rate: 10.2 }

function Num({ ch, className, children }: { ch: number; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn("tnum inline-block min-w-(--slot) text-right", className)}
      style={{ "--slot": ch + "ch" } as CSSProperties}
    >
      {children}
    </span>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[4.6em_minmax(0,1fr)] gap-x-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum min-w-0 break-words text-foreground/95">{children}</span>
    </div>
  )
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-group min-w-0">
      <h4 className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function SpeedTile({ rx, tx }: { rx: number | null; tx: number | null }) {
  return (
    <div className="metric-tile min-w-0 rounded-[0.7rem] border border-border/55 px-1.5 py-1 md:rounded-xl md:px-2.5 md:py-2">
      <div className="metric-heading flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
        <Network className="size-3 text-foreground/60 dark:text-white/65" />
        <span>网速</span>
      </div>
      <div className="tnum mt-1 grid gap-1 text-[11px] font-medium leading-none md:text-xs">
        <span className="flex min-w-0 items-center gap-1">
          <ArrowDown className="size-3 shrink-0 text-foreground/90 dark:text-white/90" />
          <span className="truncate">{rx === null ? "—" : compact(rx) + "/s"}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <ArrowUp className="size-3 shrink-0 text-foreground/90 dark:text-white/90" />
          <span className="truncate">{tx === null ? "—" : compact(tx) + "/s"}</span>
        </span>
      </div>
    </div>
  )
}

function TrafficTile({ rx, tx }: { rx: number; tx: number }) {
  return (
    <div className="metric-tile min-w-0 rounded-[0.7rem] border border-border/55 px-1.5 py-1 md:rounded-xl md:px-2.5 md:py-2">
      <div className="metric-heading flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
        <Database className="size-3 shrink-0 text-foreground/60 dark:text-white/65" />
        <span>总流量</span>
      </div>
      <div className="tnum mt-1 grid gap-1 text-[11px] font-medium leading-none md:text-xs">
        <span className="flex min-w-0 items-center gap-1">
          <ArrowDown className="size-3 shrink-0 text-foreground/90 dark:text-white/90" />
          <span className="truncate">{bytes(rx)}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <ArrowUp className="size-3 shrink-0 text-foreground/90 dark:text-white/90" />
          <span className="truncate">{bytes(tx)}</span>
        </span>
      </div>
    </div>
  )
}

function Details({ node }: { node: Node }) {
  if (!deployed(node)) {
    return <p className="px-4 py-6 text-center text-muted-foreground">尚未接入。在后台生成安装命令并执行一次。</p>
  }
  const m = node.online ? node.metrics : null
  const usage = (used: number, total: number) => `${pair(used, total)}（${percent(used, total).toFixed(1)}%）`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)} · ↑ ${bytes(tx)}`
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const days = typeof node.expires_in === "number" && Number.isFinite(node.expires_in)
    ? node.expires_in
    : daysUntil(node.expires_at)

  return (
    <div className="space-y-3 text-[13px] leading-6">
      <section className="detail-float-card system-detail-card rounded-2xl border">
        <div className="detail-groups grid gap-0">
          <DetailGroup title="系统信息">
            <Line label="系统">
              <span className="inline-flex items-center gap-1.5 align-middle">
                <OsIcon os={node.os} className="detail-os-icon" />
                {[osName(node.os), node.kernel].filter(Boolean).join(" · ") || "—"}
              </span>
            </Line>
            <Line label="架构">
              {[node.arch, node.virt !== "none" && node.virt, node.agent_version && `agent ${node.agent_version}`]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Line>
            <Line label="CPU">
              {node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
              {m && `（${m.cpu.toFixed(1)}%）`}
            </Line>
          </DetailGroup>

          <DetailGroup title="资源">
            <Line label="内存">{m ? usage(m.mem_used, m.mem_total) : bytes(node.mem_total)}</Line>
            <Line label="交换">
              {node.swap_total > 0 ? (m ? usage(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
            </Line>
            <Line label="硬盘">{m ? usage(m.disk_used, m.disk_total) : bytes(node.disk_total)}</Line>
            <Line label="负载">{m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"}</Line>
          </DetailGroup>

          <DetailGroup title="网络与连接">
            <Line label="进程">{m ? `${m.procs} · TCP ${m.tcp} · UDP ${m.udp}` : "—"}</Line>
            <Line label="网速">
              {m ? (
                <>
                  ↓ <Num ch={SLOT.rate}>{rate(m.net_rx)}</Num> · ↑ <Num ch={SLOT.rate}>{rate(m.net_tx)}</Num>
                </>
              ) : "—"}
            </Line>
            <Line label="今日">{flow(node.day_rx, node.day_tx)}</Line>
            <Line label="本月">{flow(node.month_rx, node.month_tx)}</Line>
            <Line label="总流量">{flow(node.total_rx, node.total_tx)}</Line>
          </DetailGroup>

          <DetailGroup title="服务">
            <Line label={node.online ? "在线" : "离线"}>
              {node.online ? (m ? uptime(m.uptime) : "等待上报") : away >= 60 ? uptime(away) : "刚刚"}
            </Line>
            <Line label="续费">
              {node.price > 0 ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}` : "免费"}
            </Line>
            <Line label="到期">
              {node.expires_at
                ? `${node.expires_at}（${days !== null && days < 0 ? `已过期 ${-days} 天` : `剩余 ${days} 天`}）`
                : "长期有效"}
            </Line>
            {node.traffic_reset_day > 0 && <Line label="流量重置">每月 {node.traffic_reset_day} 日</Line>}
          </DetailGroup>
        </div>
      </section>

      <div className="latency-float-card space-y-2 rounded-2xl border p-3">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">网络延迟 · 最近 1 小时</span>
          <Link href={`/node/${node.id}`} className="text-foreground/70 hover:text-foreground">查看资源图表 →</Link>
        </div>
        <Suspense fallback={<Skeleton className="h-[240px] @max-3xl:h-[190px]" />}>
          <Latency id={node.id} hours={1} className="h-[240px] @max-3xl:h-[190px]" />
        </Suspense>
      </div>
    </div>
  )
}

function ServerDetailDrawer({ node, onClose }: { node: Node; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById("root")
    const previousInert = appRoot?.inert ?? false
    const previousOverflow = document.body.style.overflow
    const previousPadding = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = "hidden"
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    if (appRoot) appRoot.inert = true
    closeRef.current?.focus({ preventScroll: true })

    const containKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return
      const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first) {
        event.preventDefault()
        closeRef.current?.focus()
      } else if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof window.Node && !drawerRef.current?.contains(event.target)) closeRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener("keydown", containKeyboard)
    document.addEventListener("focusin", containFocus)
    return () => {
      document.removeEventListener("keydown", containKeyboard)
      document.removeEventListener("focusin", containFocus)
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPadding
      if (appRoot) appRoot.inert = previousInert
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div
      className="server-detail-backdrop fixed inset-0 z-[60] flex justify-end"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside ref={drawerRef} className="server-detail-drawer flex h-full w-full max-w-[620px] flex-col" role="dialog" aria-modal="true" aria-label={`${node.name} 详情`}>
        <header className="server-detail-head sticky top-0 z-20 flex shrink-0 items-center gap-3 border-b px-4 py-3 md:px-5">
          <Dot node={node} className="monitor-status-dot" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.02em]">{node.name}</h3>
              <span className="detail-head-location inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <Flag code={node.country} className="shrink-0" />
                <span className="detail-head-os inline-flex items-center gap-1.5"><OsIcon os={node.os} /><span>{distro(node.os) || "—"}</span></span>
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="server-detail-close grid size-9 shrink-0 place-items-center rounded-full"
            onClick={onClose}
            aria-label="关闭详情"
            title="关闭详情"
          >
            <X className="size-4" strokeWidth={2.2} />
          </button>
        </header>
        <div className="server-detail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">
          <Details node={node} />
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function CompactMeter({ label, value, pct }: { label: string; value: string; pct: number | null }) {
  const level = pct !== null && pct >= 90 ? "danger" : pct !== null && pct >= 75 ? "warn" : "normal"
  return (
    <span className="compact-card-meter tnum" data-level={level} title={`${label} ${value}`} style={{ "--fill": `${Math.max(0, Math.min(100, pct ?? 0))}%` } as CSSProperties}>
      <span className="compact-card-meter-label">{value}</span>
      <span className="compact-card-meter-label-filled" aria-hidden="true">{value}</span>
    </span>
  )
}

const ServerCard = memo(function ServerCard({ node, onOpen }: { node: Node; onOpen: (id: number) => void }) {
  const m = node.online ? node.metrics : null
  const traffic = monthUsage(node)
  const memPct = m ? percent(m.mem_used, m.mem_total) : null
  const diskPct = m ? percent(m.disk_used, m.disk_total) : null
  const trafficPct = node.traffic_limit > 0 ? percent(traffic, node.traffic_limit) : null

  return (
    <article className="server-card" data-online={node.online ? "true" : "false"}>
      <button
        type="button"
        onClick={() => onOpen(node.id)}
        aria-label={`查看 ${node.name} 详情`}
        aria-haspopup="dialog"
        className="compact-card-hit compact-card-grid"
      >
        <Dot node={node} className="compact-card-dot" />
        <span className="compact-card-name" title={node.name}>{node.name}</span>
        <span className="compact-card-region"><Flag code={node.country} /></span>
        <span className="compact-card-os"><OsIcon os={node.os} /><span>{distro(node.os) || "—"}</span></span>
        <span className="compact-card-speed tnum" title={m ? `${compact(m.net_rx)} | ${compact(m.net_tx)}` : "—"}>{m ? `${compact(m.net_rx)} | ${compact(m.net_tx)}` : "—"}</span>
        <CompactMeter label="CPU" value={m ? `${m.cpu.toFixed(1)}%` : "—"} pct={m?.cpu ?? null} />
        <CompactMeter label="内存" value={memPct === null ? "—" : `${memPct.toFixed(1)}%`} pct={memPct} />
        <CompactMeter label="硬盘" value={diskPct === null ? "—" : `${diskPct.toFixed(1)}%`} pct={diskPct} />
        <CompactMeter label="流量" value={`${compact(traffic)} / ${node.traffic_limit > 0 ? compact(node.traffic_limit) : FOREVER}`} pct={trafficPct} />
      </button>
    </article>
  )
})

const STATUS_FILTERS: { value: NodeStatusFilter; label: string; title?: string }[] = [
  { value: "all", label: "全部" },
  { value: "online", label: "在线" },
  { value: "offline", label: "离线", title: "包含尚未接入的服务器" },
  { value: "attention", label: "异常", title: "离线、未接入、缺少上报，CPU / 内存 / 硬盘 ≥ 90%，或流量额度耗尽" },
]

export function ServerTable({ nodes }: { nodes: Node[] }) {
  const [detailId, setDetailId] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [preferences, setPreferences] = useState(() => readListPreferences())
  const deferredQuery = useDeferredValue(query)
  const closeDetail = useCallback(() => setDetailId(null), [])
  const detailNode = detailId === null ? null : nodes.find((node) => node.id === detailId) ?? null
  const visibleNodes = useMemo(() => selectNodes(nodes, deferredQuery, preferences), [nodes, deferredQuery, preferences])
  const summary = useMemo(() => {
    const values = { online: 0, attention: 0, rxRate: 0, txRate: 0, totalRx: 0, totalTx: 0 }
    for (const node of nodes) {
      values.totalRx += node.total_rx
      values.totalTx += node.total_tx
      if (node.online) values.online++
      if (needsAttention(node)) values.attention++
      if (node.online && node.metrics) {
        values.rxRate += node.metrics.net_rx
        values.txRate += node.metrics.net_tx
      }
    }
    return values
  }, [nodes])
  const statusCounts = { all: nodes.length, online: summary.online, offline: nodes.length - summary.online, attention: summary.attention }
  const hasFilters = query.trim() !== "" || preferences.status !== "all"

  useEffect(() => saveListPreferences(preferences), [preferences])

  const clearFilters = () => {
    setQuery("")
    setPreferences((current) => ({ ...current, status: "all" }))
  }
  const sortBy = (sort: NodeSortKey) => {
    setPreferences((current) => ({
      ...current,
      sort,
      direction: current.sort === sort ? (current.direction === "asc" ? "desc" : "asc") : (sort === "name" ? "asc" : "desc"),
    }))
  }
  const SortArrow = preferences.direction === "asc" ? ArrowUp : ArrowDown

  return (
    <section className="server-panel @container space-y-3">
      <article className="server-card server-summary-card">
        <div className="server-summary-row grid grid-cols-[minmax(118px,1.05fr)_minmax(0,2fr)] items-stretch gap-2 p-2.5 md:grid-cols-[minmax(190px,1.05fr)_minmax(0,2fr)] md:gap-2.5 md:p-3">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <span className="summary-icon grid size-5 shrink-0 place-items-center rounded-full md:size-6">
              <Server className="size-3.5 md:size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] md:text-[15px]">在线服务器</p>
              <p className="tnum mt-0.5 text-[11px] text-muted-foreground md:text-xs">{summary.online} / {nodes.length}</p>
            </div>
          </div>

          <div className="server-metrics summary-metrics grid min-w-0 grid-cols-2">
            <SpeedTile rx={summary.rxRate} tx={summary.txRate} />
            <TrafficTile rx={summary.totalRx} tx={summary.totalTx} />
          </div>
        </div>
      </article>

      <div className="server-list-controls space-y-3 pt-1">
        <div className="server-toolbar flex flex-wrap items-center gap-2">
          <div className="server-search relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="搜索服务器"
              placeholder="搜索名称、地区、系统…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-xl border bg-transparent pl-9 pr-9 text-xs outline-none"
            />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="清除搜索" className="absolute right-1 top-1 grid size-8 place-items-center rounded-lg text-muted-foreground"><X className="size-3.5" /></button>}
          </div>
          <div className="server-status-filters flex items-center gap-1 rounded-xl border p-1" role="group" aria-label="服务器状态筛选">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={preferences.status === filter.value}
                title={filter.title}
                onClick={() => setPreferences((current) => ({ ...current, status: filter.value }))}
                className="server-filter-button inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs"
              >
                {filter.label}<span className="tnum text-[10px] opacity-65">{statusCounts[filter.value]}</span>
              </button>
            ))}
          </div>
          <div className="server-sort-controls flex items-center gap-1.5">
            <select aria-label="服务器排序" value={preferences.sort} onChange={(event) => setPreferences((current) => ({ ...current, sort: event.target.value as NodeSortKey }))} className="server-sort-select h-10 rounded-xl border bg-transparent px-3 text-xs outline-none">
              <option value="default">默认排序</option>
              <option value="name">名称</option>
              <option value="cpu">CPU 使用率</option>
              <option value="memory">内存使用率</option>
              <option value="traffic">本月流量</option>
              <option value="network">总网速</option>
            </select>
            <button
              type="button"
              aria-label={`当前${preferences.direction === "asc" ? "升序，切换为降序" : "降序，切换为升序"}`}
              title={preferences.direction === "asc" ? "升序" : "降序"}
              onClick={() => setPreferences((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}
              className="server-sort-direction grid size-10 place-items-center rounded-xl border"
            ><SortArrow className="size-3.5" /></button>
          </div>
        </div>
        {hasFilters && <div className="flex justify-end px-1 text-xs text-muted-foreground">
          <button type="button" onClick={clearFilters} className="server-clear-filters rounded-md underline-offset-4 hover:underline">清除筛选</button>
        </div>}
      </div>

      <div className="server-node-list space-y-1.5 md:space-y-2" aria-busy={query !== deferredQuery}>
        <div className="compact-card-head compact-card-grid">
          <span>状态</span>
          <button type="button" className="compact-sort" onClick={() => sortBy("name")} aria-label="按服务器名称排序">名称{preferences.sort === "name" && <SortArrow />}</button>
          <span>地区</span>
          <span className="compact-card-system-head">系统</span>
          <button type="button" className="compact-sort compact-card-speed-head" onClick={() => sortBy("network")} aria-label="按网速排序">网速<span className="compact-card-directions"> ↓|↑</span>{preferences.sort === "network" && <SortArrow />}</button>
          <button type="button" className="compact-sort" onClick={() => sortBy("cpu")} aria-label="按CPU排序">CPU{preferences.sort === "cpu" && <SortArrow />}</button>
          <button type="button" className="compact-sort" onClick={() => sortBy("memory")} aria-label="按内存排序">内存{preferences.sort === "memory" && <SortArrow />}</button>
          <span>硬盘</span>
          <button type="button" className="compact-sort" onClick={() => sortBy("traffic")} aria-label="按本月流量排序">流量{preferences.sort === "traffic" && <SortArrow />}</button>
        </div>
        {visibleNodes.length ? visibleNodes.map((node) => <ServerCard key={node.id} node={node} onOpen={setDetailId} />) : (
          <div className="server-empty-state rounded-2xl border border-dashed px-5 py-10 text-center">
            <Search aria-hidden="true" className="mx-auto mb-3 size-5 text-muted-foreground" />
            <p className="text-sm font-medium">{nodes.length ? "没有符合条件的服务器" : "暂无服务器"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{nodes.length ? "试试其他关键词，或清除筛选条件。" : "服务器接入后会在这里显示。"}</p>
            {hasFilters && <button type="button" onClick={clearFilters} className="server-monitor-link mt-4 rounded-full px-4 py-2 text-xs font-medium">清除筛选</button>}
          </div>
        )}
      </div>

      {detailNode && <ServerDetailDrawer node={detailNode} onClose={closeDetail} />}
    </section>
  )
}
