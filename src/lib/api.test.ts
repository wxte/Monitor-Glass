/// <reference types="node" />
import assert from "node:assert/strict"
import { mock } from "node:test"
import { safeNodes, shareNodes, subscribeNodes, type Node } from "./api.ts"

const node = { id: 1, metrics: { uptime: 100, cpu: 1, load: [0.1, 0.2, 0.3],
  mem_total: 1024, mem_used: 512, swap_total: 0, swap_used: 0, disk_total: 2048, disk_used: 1024,
  net_rx: 10, net_tx: 20, total_rx: 100, total_tx: 200, month_rx: 50, month_tx: 100,
  tcp: 3, udp: 4, procs: 20 } } as Node
assert.equal(safeNodes([node])[0], node)
for (const patch of [{ load: null }, { load: [1, "bad", 3] }, { cpu: "bad" }, { net_rx: Infinity }, { uptime: -1 }]) {
  const bad = { ...node, metrics: { ...node.metrics, ...patch } } as unknown as Node
  const result = safeNodes([bad, node])
  assert.equal(result[0].metrics, null)
  assert.equal(result[1], node)
}
assert.deepEqual(safeNodes([null, undefined, "bad", {}, node]), [node])
for (const invalid of [null, undefined, {}, "bad"]) assert.throws(() => safeNodes(invalid), /格式异常/)

const clone = (value: Node): Node => structuredClone(value)
const previous = [node, { ...clone(node), id: 2 }]
assert.equal(shareNodes(previous, previous.map(clone)), previous, "identical snapshots keep the array and row references")
const changed = { ...clone(previous[1]), metrics: { ...previous[1].metrics!, cpu: 30 } }
const next = shareNodes(previous, [clone(node), changed])
assert.equal(next[0], node, "an update to one node does not invalidate another row")
assert.equal(next[1], changed)
const renamed = shareNodes(previous, [{ ...clone(node), name: "Renamed" }])
assert.equal(renamed[0].metrics, node.metrics, "metadata updates reuse unchanged metrics")
assert.equal(renamed[0].name, "Renamed")
const reordered = shareNodes(previous, [clone(previous[1]), clone(node)])
assert.equal(reordered[0], previous[1])
assert.equal(reordered[1], node)
assert.equal(shareNodes(previous, [clone(previous[1])])[0], previous[1], "removing a node preserves surviving rows")
assert.equal(shareNodes(null, previous), previous)

type PendingRequest = {
  signal: AbortSignal
  resolve: (response: Response) => void
  reject: (error: Error) => void
}
class MockSocket {
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  message(data: unknown) { this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }) }
  close() { this.closed = true; this.onclose?.() }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const answer = (request: PendingRequest, value: unknown, status = 200) => request.resolve(new Response(JSON.stringify(value), { status }))

async function liveTest(run: (context: {
  requests: PendingRequest[]
  sockets: MockSocket[]
  received: Node[][]
  errors: Error[]
  stop: () => void
}) => Promise<void>, constructorFails = false) {
  const requests: PendingRequest[] = []
  const sockets: MockSocket[] = []
  const received: Node[][] = []
  const errors: Error[] = []
  const location = Object.getOwnPropertyDescriptor(globalThis, "location")
  Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "https:", host: "monitor.test" } })
  mock.timers.enable({ apis: ["setTimeout"] })
  mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ signal: init!.signal!, resolve, reject })
  }))
  mock.method(globalThis, "WebSocket", function () {
    if (constructorFails) throw new Error("WebSocket unavailable")
    const socket = new MockSocket()
    sockets.push(socket)
    return socket
  })
  const stop = subscribeNodes({ onNodes: (nodes) => received.push(nodes), onError: (error) => errors.push(error) })
  try {
    await run({ requests, sockets, received, errors, stop })
  } finally {
    stop()
    mock.timers.reset()
    mock.restoreAll()
    if (location) Object.defineProperty(globalThis, "location", location)
    else Reflect.deleteProperty(globalThis, "location")
  }
}

await liveTest(async ({ requests, sockets, received, errors }) => {
  sockets[0].message({ nodes: [changed] })
  assert.equal(requests[0].signal.aborted, true, "a live snapshot cancels the initial fetch")
  answer(requests[0], { nodes: [node] })
  await flush()
  assert.equal(received.length, 1, "a late HTTP answer cannot overwrite newer live data")
  assert.equal(received[0][0].metrics?.cpu, 30)
  assert.equal(errors.length, 0)

  for (const invalid of ["not-json", { nodes: null }, null]) {
    const current = sockets.at(-1)!
    assert.doesNotThrow(() => current.message(invalid), "malformed messages cannot crash the UI")
    assert.equal(current.closed, true)
    mock.timers.tick(5000)
    answer(requests.at(-1)!, { nodes: [node] })
    await flush()
  }
  assert.equal(errors.length, 3)
  sockets.at(-1)!.message({ nodes: [node] })
  const count = requests.length
  mock.timers.tick(20000)
  await flush()
  assert.equal(requests.length, count, "a healthy stream stops fallback polling")
})

await liveTest(async ({ requests, sockets, received }) => {
  sockets[0].message({ nodes: [node] })
  answer(requests[0], { nodes: [node] })
  await flush()
  mock.timers.tick(29999)
  assert.equal(sockets[0].closed, false, "a reporting stream stays connected")
  mock.timers.tick(1)
  assert.equal(sockets[0].closed, true, "a silent stream is closed after its watchdog expires")
  mock.timers.tick(5000)
  assert.equal(sockets.length, 2, "a silent stream reconnects")
  assert.equal(requests.length, 2, "fallback polling resumes while the stream reconnects")
  answer(requests[1], { nodes: [node] })
  await flush()
  sockets[1].message({ nodes: [changed] })
  assert.equal(received.at(-1)?.[0].metrics?.cpu, 30)
})

await liveTest(async ({ requests, sockets, errors }) => {
  sockets[0].close()
  mock.timers.tick(5000)
  await flush()
  mock.timers.tick(5000)
  await flush()
  assert.equal(requests.length, 1, "fallback polling cannot overlap a slow initial request")
  answer(requests[0], { nodes: [node] })
  await flush()
  mock.timers.tick(5000)
  assert.equal(requests.length, 2)
  mock.timers.tick(20000)
  await flush()
  assert.equal(requests.length, 2, "slow fallback requests do not accumulate")
  answer(requests[1], {}, 401)
  await flush()
  assert.equal((errors[0] as Error & { status: number }).status, 401, "access changes reach the public-page redirect logic")
  mock.timers.tick(5000)
  assert.equal(requests.length, 3, "polling resumes after a failed request")
})

await liveTest(async ({ requests, sockets, received, errors, stop }) => {
  sockets[0].close()
  stop()
  assert.equal(requests[0].signal.aborted, true, "unmount aborts the active request")
  requests[0].reject(new Error("late failure"))
  await flush()
  mock.timers.tick(20000)
  assert.equal(requests.length, 1)
  assert.equal(sockets.length, 1, "unmount clears reconnect timers")
  assert.equal(received.length, 0)
  assert.equal(errors.length, 0, "unmount ignores late errors")
})

await liveTest(async ({ requests, sockets }) => {
  answer(requests[0], { nodes: [node] })
  await flush()
  sockets[0].close()
  mock.timers.tick(5000)
  sockets[1].message({ nodes: [node] })
  assert.equal(requests[1].signal.aborted, true)
  sockets[1].close()
  mock.timers.tick(2500)
  answer(requests[1], { nodes: [node] })
  await flush()
  mock.timers.tick(2500)
  answer(requests[2], { nodes: [node] })
  await flush()
  mock.timers.tick(2500)
  await flush()
  assert.equal(requests.length, 3, "a stale polling loop cannot schedule extra requests after another disconnect")
})

await liveTest(async ({ requests, received, errors }) => {
  answer(requests[0], { nodes: [node] })
  await flush()
  mock.timers.tick(5000)
  assert.equal(requests.length, 2, "constructor failures still enable polling")
  answer(requests[1], { nodes: [changed] })
  await flush()
  assert.equal(received.length, 2)
  assert.equal(errors.length, 0)
}, true)

console.log("live reports: validation, structural sharing, stale responses, reconnects, serialized polling and cleanup passed")
