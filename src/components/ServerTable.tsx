import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Cpu, Database, HardDrive, MemoryStick, Network, Server, type LucideIcon } from "lucide-react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Skeleton } from "@/components/ui/skeleton"
import type { Node } from "@/lib/api"
import {
  bytes, compact, CYCLES, daysUntil, distro, duration, FOREVER, money, monthUsage, osName, cpuName, pair,
  percent, rate, uptime,
} from "@/lib/format"
import { Link } from "@/lib/route"
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
  return (
    <span
      title={node.online ? "在线" : deployed(node) ? "离线" : "未接入"}
      className={cn(
        "inline-block size-3 shrink-0 rounded-full align-middle",
        node.online ? "bg-(image:--dot-online)" : deployed(node) ? "bg-(image:--dot-offline)" : "bg-muted-foreground/40",
        className,
      )}
    />
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

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="text-muted-foreground" title="永不到期">{FOREVER}</span>
  if (days < 0) return <span className="text-danger">已过期</span>
  return <span className={cn(days <= 7 && "text-warn")}>{days} 天</span>
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[5.5em_minmax(0,1fr)] gap-x-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum break-words">{children}</span>
    </div>
  )
}

function meterTone(pct: number | null) {
  if (pct === null) return "bg-muted-foreground/25"
  if (pct >= 90) return "bg-red-500"
  if (pct >= 75) return "bg-orange-400"
  return "bg-primary"
}

function MiniMeter({ pct }: { pct: number | null }) {
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/7 dark:bg-white/8">
      <span
        className={cn("block h-full rounded-full transition-[width] duration-500", meterTone(pct))}
        style={{ width: value + "%" }}
      />
    </span>
  )
}

function MetricTile({
  label,
  value,
  pct,
  icon: Icon,
  className,
}: {
  label: string
  value: string
  pct: number | null
  icon: LucideIcon
  className?: string
}) {
  return (
    <div className={cn("metric-tile min-w-0 rounded-xl border border-border/55 px-2 py-1.5 md:px-2.5 md:py-2", className)}>
      <div className="flex min-w-0 items-center gap-1 text-[9px] leading-none text-muted-foreground md:text-[10px]">
        <Icon className="size-3 shrink-0 text-primary/85" />
        <span className="truncate">{label}</span>
      </div>
      <div className="tnum mt-1 truncate text-[10px] font-medium leading-none md:text-xs">{value}</div>
      <MiniMeter pct={pct} />
    </div>
  )
}

function SpeedTile({ rx, tx }: { rx: number; tx: number }) {
  return (
    <div className="metric-tile min-w-0 rounded-xl border border-border/55 px-2 py-1.5 md:px-2.5 md:py-2">
      <div className="flex items-center gap-1 text-[9px] leading-none text-muted-foreground md:text-[10px]">
        <Network className="size-3 text-primary/85" />
        <span>网速</span>
      </div>
      <div className="tnum mt-1 grid gap-0.5 text-[10px] font-medium leading-none md:text-xs">
        <span className="flex min-w-0 items-center gap-1">
          <ArrowDown className="size-3 shrink-0 text-primary" />
          <span className="truncate">{compact(rx)}/s</span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <ArrowUp className="size-3 shrink-0 text-orange-500" />
          <span className="truncate">{compact(tx)}/s</span>
        </span>
      </div>
    </div>
  )
}

function Details({ node }: { node: Node }) {
  if (!deployed(node)) {
    return <p className="px-4 py-3 text-muted-foreground">尚未接入。在后台生成安装命令并执行一次。</p>
  }
  const m = node.online ? node.metrics : null
  const usage = (used: number, total: number) => `${pair(used, total)}（${percent(used, total).toFixed(1)}%）`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)} · ↑ ${bytes(tx)}`
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const days = daysUntil(node.expires_at)

  return (
    <div className="space-y-3 p-3 text-[13px] leading-6 md:p-4 @max-3xl:text-xs @max-3xl:leading-5">
      {/* Three across, one topic a row: the machine, what it holds, what it is
          doing, what it has moved, and its term. Low enough that the chart
          beneath stays in view when a row opens. */}
      <div className="grid gap-x-8 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Line label="系统">
          <span className="inline-flex items-center gap-1.5 align-middle">
            <OsIcon os={node.os} />
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

        <Line label="内存">{m ? usage(m.mem_used, m.mem_total) : bytes(node.mem_total)}</Line>
        <Line label="交换">
          {node.swap_total > 0 ? (m ? usage(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
        </Line>
        <Line label="硬盘">{m ? usage(m.disk_used, m.disk_total) : bytes(node.disk_total)}</Line>

        <Line label="负载">{m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"}</Line>
        <Line label="进程 / 连接">{m ? `${m.procs} · TCP ${m.tcp} · UDP ${m.udp}` : "—"}</Line>
        <Line label="网速">
          {m ? (
            <>
              ↓ <Num ch={SLOT.rate}>{rate(m.net_rx)}</Num> · ↑ <Num ch={SLOT.rate}>{rate(m.net_tx)}</Num>
            </>
          ) : (
            "—"
          )}
        </Line>

        <Line label="今日流量">{flow(node.day_rx, node.day_tx)}</Line>
        <Line label="本月流量">{flow(node.month_rx, node.month_tx)}</Line>
        <Line label="总流量">{flow(node.total_rx, node.total_tx)}</Line>

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

        {node.traffic_reset_day > 0 && (
          <Line label="流量重置">每月 {node.traffic_reset_day} 日重置</Line>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-border/60 bg-background/45 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.45)] dark:bg-black/10">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">网络延迟 · 最近 24 小时</span>
          <Link href={`/node/${node.id}`} className="text-primary hover:underline">查看资源图表 →</Link>
        </div>
        {/* Fetched when the row opens, from the chart page's chunk, which App
            warms at start, so the table itself carries no recharts. */}
        <Suspense fallback={<Skeleton className="h-[280px] @max-3xl:h-[220px]" />}>
          <Latency id={node.id} className="h-[280px] @max-3xl:h-[220px]" />
        </Suspense>
      </div>
    </div>
  )
}


function ServerCard({ node }: { node: Node }) {
  const [open, setOpen] = useState(false)
  const m = node.online ? node.metrics : null
  const traffic = monthUsage(node)
  const memPct = m ? percent(m.mem_used, m.mem_total) : null
  const diskPct = m ? percent(m.disk_used, m.disk_total) : null
  const trafficPct = node.traffic_limit > 0 ? percent(traffic, node.traffic_limit) : null
  const state = node.online ? "在线" : deployed(node) ? "离线" : "未接入"
  const sub = [
    state,
    m ? duration(m.uptime) : "",
    distro(node.os),
  ].filter(Boolean).join(" · ")

  return (
    <article
      className={cn("server-card", open && "server-card-open")}
      data-online={node.online ? "true" : "false"}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="server-card-hit grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2.5 text-left sm:p-3 md:grid-cols-[minmax(190px,1.05fr)_minmax(0,4fr)_28px] md:gap-2.5"
      >
        <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
          <span className="status-orbit grid size-8 shrink-0 place-items-center rounded-full md:size-9">
            <Dot node={node} className="server-status-dot size-3 md:size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-[-0.01em] md:text-[15px]" title={node.name}>
                {node.name}
              </span>
              <Flag code={node.country} className="shrink-0 text-[10px]" />
              {open && node.online && (
                <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-primary ring-1 ring-primary/15">
                  LIVE
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground md:text-[11px]">{sub || "—"}</div>
          </div>
        </div>

        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 md:order-last md:justify-self-end",
            open && "rotate-180 text-primary",
          )}
        />

        <div className="col-span-2 grid min-w-0 grid-cols-[1.22fr_repeat(4,minmax(0,1fr))] gap-1.5 md:col-span-1 md:col-start-2 md:row-start-1 md:gap-2">
          <SpeedTile rx={m?.net_rx ?? 0} tx={m?.net_tx ?? 0} />
          <MetricTile label="CPU" value={m ? m.cpu.toFixed(1) + "%" : "—"} pct={m?.cpu ?? null} icon={Cpu} />
          <MetricTile label="内存" value={memPct === null ? "—" : memPct.toFixed(1) + "%"} pct={memPct} icon={MemoryStick} />
          <MetricTile label="硬盘" value={diskPct === null ? "—" : diskPct.toFixed(1) + "%"} pct={diskPct} icon={HardDrive} />
          <MetricTile
            label="流量"
            value={compact(traffic) + " / " + (node.traffic_limit > 0 ? compact(node.traffic_limit) : FOREVER)}
            pct={trafficPct}
            icon={Database}
          />
        </div>
      </button>

      {open && (
        <div className="server-card-detail border-t border-border/55">
          <Details node={node} />
        </div>
      )}
    </article>
  )
}

export function ServerTable({ nodes }: { nodes: Node[] }) {
  let onlineCount = 0
  let rxRate = 0
  let txRate = 0
  let totalRx = 0
  let totalTx = 0

  for (const node of nodes) {
    totalRx += node.total_rx
    totalTx += node.total_tx
    if (node.online) onlineCount++
    if (node.online && node.metrics) {
      rxRate += node.metrics.net_rx
      txRate += node.metrics.net_tx
    }
  }

  return (
    <section className="server-panel @container space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] md:text-2xl">服务器</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground md:text-xs">实时监控 · 稳定运行 · 全局总览</p>
        </div>
        <span className="rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm">
          {onlineCount === nodes.length ? "全部在线" : "在线 " + onlineCount + " / " + nodes.length}
        </span>
      </div>

      <div className="server-summary grid grid-cols-3 overflow-hidden rounded-2xl border border-border/60">
        <div className="flex min-w-0 items-center gap-2.5 p-3 md:p-4">
          <span className="summary-icon grid size-9 shrink-0 place-items-center rounded-xl text-primary md:size-11">
            <Server className="size-4 md:size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground md:text-[10px]">在线服务器</p>
            <p className="tnum mt-0.5 text-base font-semibold md:text-xl">{onlineCount} / {nodes.length}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-2 border-x border-border/55 p-3 md:p-4">
          <Network className="hidden size-5 shrink-0 text-primary/80 sm:block" />
          <div className="tnum min-w-0 text-[10px] font-medium md:text-xs">
            <p className="flex items-center gap-1"><ArrowDown className="size-3 text-primary" />{compact(rxRate)}/s</p>
            <p className="mt-1 flex items-center gap-1"><ArrowUp className="size-3 text-orange-500" />{compact(txRate)}/s</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 p-3 md:p-4">
          <Database className="hidden size-5 shrink-0 text-primary/80 sm:block" />
          <div className="tnum min-w-0 text-right text-[10px] md:text-xs">
            <p className="truncate font-semibold">↓ {bytes(totalRx)}</p>
            <p className="mt-1 truncate text-muted-foreground">↑ {bytes(totalTx)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {nodes.map((node) => <ServerCard key={node.id} node={node} />)}
      </div>
    </section>
  )
}
