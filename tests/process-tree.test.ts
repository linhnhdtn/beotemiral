import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { ProcessTree } from '../src/main/process-tree'

type Process = { pid: number; parent: number; session: number; start: string }

function fixture(t: TestContext) {
  let table: Process[] = []
  let scans = 0
  const trees: ProcessTree[] = []
  const timers = new Map<NodeJS.Timeout, () => void>()
  const signals: { pid: number; signal: NodeJS.Signals | number | undefined }[] = []
  const readDirectory = fs.readdirSync, readFile = fs.readFileSync
  t.mock.method(fs, 'readdirSync', ((path: fs.PathLike, ...args: unknown[]) => {
    if (path !== '/proc') return Reflect.apply(readDirectory, fs, [path, ...args])
    scans++
    return table.map(p => String(p.pid))
  }) as typeof fs.readdirSync)
  t.mock.method(fs, 'readFileSync', ((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    const match = String(path).match(/^\/proc\/(\d+)\/stat$/)
    if (!match) return Reflect.apply(readFile, fs, [path, ...args])
    const entry = table.find(p => p.pid === Number(match[1]))!
    const fields = Array<string>(20).fill('0')
    fields[0] = 'S'; fields[1] = String(entry.parent); fields[3] = String(entry.session); fields[19] = entry.start
    return `${entry.pid} (test process) ${fields.join(' ')}`
  }) as typeof fs.readFileSync)
  syncBuiltinESMExports()
  t.mock.method(globalThis, 'setInterval', ((callback: () => void, ms: number) => {
    assert.equal(ms, 300)
    const timer = { unref() { return this } } as NodeJS.Timeout
    timers.set(timer, callback)
    return timer
  }) as typeof setInterval)
  t.mock.method(globalThis, 'clearInterval', (timer: NodeJS.Timeout) => { timers.delete(timer) })
  t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
    signals.push({ pid, signal })
    return true
  })
  t.after(async () => {
    table = []
    await Promise.all(trees.map(tree => tree.stop()))
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
  return {
    setTable: (value: Process[]) => { table = value },
    create: (root: number) => { const tree = new ProcessTree(root); trees.push(tree); return tree },
    tick: () => { for (const callback of timers.values()) callback() },
    scans: () => scans,
    timers, signals
  }
}

test('twenty trees share one periodic scan and release the timer when the last tree stops', async t => {
  const f = fixture(t)
  const trees = Array.from({ length: 20 }, (_, i) => f.create(100 + i))
  assert.equal(f.timers.size, 1)
  const scans = f.scans()
  f.tick()
  assert.equal(f.scans() - scans, 1, 'one /proc enumeration for all twenty sessions')
  await Promise.all(trees.slice(0, -1).map(tree => tree.stop()))
  assert.equal(f.timers.size, 1, 'the remaining session still needs monitoring')
  await trees.at(-1)!.stop()
  assert.equal(f.timers.size, 0)
  const next = f.create(500)
  assert.equal(f.timers.size, 1, 'monitoring restarts for a new session')
  await next.stop()
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.signals, [])
})

test('fresh stop scans preserve descendants, ignore recycled PIDs and leave other sessions alone', async t => {
  const f = fixture(t)
  f.setTable([
    { pid: 100, parent: 1, session: 100, start: 'a' },
    { pid: 101, parent: 100, session: 101, start: 'b' },
    { pid: 102, parent: 100, session: 102, start: 'c' },
    { pid: 200, parent: 1, session: 200, start: 'd' }
  ])
  const owned = f.create(100)
  const other = f.create(200)
  f.tick()
  // A child has detached/reparented; another PID was recycled. A new child starts
  // after the periodic scan and must still be found immediately when stopping.
  f.setTable([
    { pid: 100, parent: 1, session: 100, start: 'a' },
    { pid: 101, parent: 1, session: 101, start: 'b' },
    { pid: 102, parent: 1, session: 102, start: 'recycled' },
    { pid: 103, parent: 101, session: 103, start: 'new' },
    { pid: 200, parent: 1, session: 200, start: 'd' }
  ])
  const scans = f.scans()
  const stopping = owned.stop()
  assert.equal(owned.stop(), stopping, 'concurrent stops share the same cleanup')
  assert.deepEqual(f.signals.map(p => p.pid), [101, 103, 100])
  assert.equal(f.timers.size, 1)
  // Only a TERM-ignoring descendant remains for the fresh SIGKILL scan.
  f.setTable([{ pid: 103, parent: 1, session: 103, start: 'new' }, { pid: 200, parent: 1, session: 200, start: 'd' }])
  await stopping
  assert.equal(f.scans() - scans, 2)
  assert.deepEqual(f.signals.at(-1), { pid: 103, signal: 'SIGKILL' })
  assert.ok(f.signals.every(p => p.pid !== 102 && p.pid !== 200))
  f.setTable([])
  await other.stop()
})
