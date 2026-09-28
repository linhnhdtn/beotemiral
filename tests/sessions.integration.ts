import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { SessionManager, isLive } from '../src/main/sessions'
import { WorkspaceStore, freshWorkspace } from '../src/main/store'
import type { LaunchSpec, TerminalOutput, Workspace } from '../src/shared/types'

async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(25)
  }
  assert.fail(`Timed out: ${description}`)
}

function fixture(t: TestContext, shell = '/bin/bash', workspace: Workspace = freshWorkspace()) {
  const dir = mkdtempSync(join(tmpdir(), 'task-harbor-pty-'))
  const manager = new SessionManager(workspace, shell)
  const output = new Map<string, string>()
  const events: TerminalOutput[] = []
  manager.on('output', (event: TerminalOutput) => {
    output.set(event.id, (output.get(event.id) ?? '') + event.data)
    events.push(event)
  })
  t.after(async () => {
    await manager.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })
  const create = (command = '', overrides: Partial<LaunchSpec> = {}) => manager.create({
    name: 'Phiên kiểm thử', kind: 'terminal', groupId: workspace.groups[0].id, cwd: dir, command, ...overrides
  })
  return { dir, manager, output, events, create }
}

function processInfo(pid: number): { state: string; group: number; session: number } | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
    return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]) }
  } catch { return undefined }
}

function alive(pid: number): boolean {
  const info = processInfo(pid)
  return info !== undefined && info.state !== 'Z'
}

test('real commands expose successful and nonzero exit codes, Unicode and ANSI output', { timeout: 20_000 }, async t => {
  const { manager, create, output, events } = fixture(t)
  const success = create("printf '\\033[32mXin chào Việt Nam\\033[0m\\n'; exit 0")
  const failure = create("printf 'failed-command\\n'; exit 17", { kind: 'agent' })
  await until(() => !isLive(manager.get(success)) && !isLive(manager.get(failure)), 'both commands finish')
  await until(() => (output.get(success) ?? '').includes('Xin chào Việt Nam'), 'UTF-8 output delivered')
  assert.equal(manager.get(success).status, 'finished')
  assert.equal(manager.get(success).exitCode, 0)
  assert.equal(manager.get(failure).status, 'error')
  assert.equal(manager.get(failure).exitCode, 17)
  assert.ok(manager.get(success).endedAt)
  const snapshot = await manager.snapshot(success)
  assert.match(snapshot.data, /Xin chào Việt Nam/)
  assert.match(snapshot.data, /\x1b\[/, 'ANSI state survives terminal serialization')
  const seqs = events.filter(e => e.id === success).map(e => e.seq)
  assert.deepEqual(seqs, seqs.map((_, index) => index + 1))
  assert.equal(snapshot.seq, seqs.at(-1))
})

test('invalid directories and missing shells create readable error sessions', async t => {
  const { manager, dir, create } = fixture(t)
  const file = join(dir, 'plain-file')
  writeFileSync(file, '')
  for (const cwd of [join(dir, 'missing'), file, 'relative/path']) {
    const id = create('', { cwd })
    assert.equal(manager.get(id).status, 'error')
    assert.ok(manager.get(id).error)
    assert.equal(manager.get(id).pid, undefined)
  }
  const missing = fixture(t, '/nonexistent/task-harbor-shell')
  const id = missing.create()
  await until(() => !isLive(missing.manager.get(id)), 'missing shell reports launch failure')
  assert.equal(missing.manager.get(id).status, 'error')
  assert.ok(missing.manager.get(id).error || (await missing.manager.snapshot(id)).data, 'launch failure must include diagnostic text')
})

test('interactive shell accepts Unicode, Ctrl+C, resize, and stays alive across snapshots', { timeout: 20_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create()
  const pid = manager.get(id).pid!
  manager.write(id, "printf '\\n%s\\n' 'Dữ liệu từ bàn phím'; sleep 120\r")
  await until(() => (output.get(id) ?? '').includes('\r\nDữ liệu từ bàn phím\r\n'), 'interactive Unicode command executed')
  manager.write(id, '\x03')
  manager.resize(id, 82, 22)
  manager.write(id, "printf '\\nSIZE:'; stty size; printf 'AFTER_INTERRUPT\\n'\r")
  await until(() => (output.get(id) ?? '').includes('SIZE:22 82'), 'PTY resize and command after interrupt')
  const first = await manager.snapshot(id)
  const second = await manager.snapshot(id)
  assert.equal(first.cols, 82)
  assert.equal(first.rows, 22)
  assert.match(first.data, /AFTER_INTERRUPT/)
  assert.equal(first.data, second.data)
  assert.equal(manager.get(id).pid, pid)
  assert.equal(manager.get(id).status, 'running')
  assert.ok(alive(pid))
})

test('terminal history is bounded while retaining the latest output', { timeout: 20_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create("for ((i=0;i<6500;i++)); do printf 'ROW_%04d\\n' \"$i\"; done")
  await until(() => (output.get(id) ?? '').includes('ROW_6499'), 'large command output delivered')
  const snapshot = await manager.snapshot(id)
  assert.match(snapshot.data, /ROW_6499/)
  assert.doesNotMatch(snapshot.data, /ROW_0000/)
  assert.ok(snapshot.data.length < 100_000, `unexpectedly large history: ${snapshot.data.length}`)
  assert.ok(snapshot.data.split('\n').length <= 5028)
})

test('a background terminal answers cursor-position queries without a renderer', { timeout: 15_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create("stty -echo -icanon; printf '\\033[6n'; IFS= read -r -d R -t 3 reply; printf 'DSR_REPLY:%sR:END\\n' \"$reply\"")
  await until(() => !isLive(manager.get(id)), 'background query command completes')
  await until(() => (output.get(id) ?? '').includes(':END'), 'cursor-query reply printed')
  assert.match(output.get(id)!, /DSR_REPLY:\x1b\[\d+;\d+R:END/, 'headless terminal must reply to DSR through the PTY')
  assert.equal(manager.get(id).status, 'finished')
})

test('stop cleans shell background jobs in separate process groups and preserves unrelated tasks', { timeout: 20_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create("sleep 120 & child=$!; printf 'CHILD_PID:%s\\n' \"$child\"; wait")
  const other = create('sleep 120')
  await until(() => /CHILD_PID:\d+/.test(output.get(id) ?? ''), 'background child starts')
  const child = Number(output.get(id)!.match(/CHILD_PID:(\d+)/)![1])
  const root = manager.get(id).pid!
  const otherRoot = manager.get(other).pid!
  assert.ok(alive(root) && alive(child))
  assert.notEqual(processInfo(root)?.group, processInfo(child)?.group, 'exercise shell job-control process groups')
  await manager.stop(id)
  await until(() => !alive(root) && !alive(child), 'the full stopped tree exits')
  assert.equal(manager.get(id).status, 'stopped')
  assert.ok(alive(otherRoot), 'stopping one session must not kill another session')
})

test('natural command exit cleans disowned descendants, including a child ignoring SIGTERM', { timeout: 20_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create("trap '' HUP; (trap '' TERM; exec sleep 120) & child=$!; disown \"$child\"; printf 'CHILD_PID:%s\\n' \"$child\"; sleep 0.3; exit 0")
  await until(() => /CHILD_PID:\d+/.test(output.get(id) ?? ''), 'disowned child starts')
  const child = Number(output.get(id)!.match(/CHILD_PID:(\d+)/)![1])
  assert.ok(alive(child))
  await until(() => manager.get(id).status === 'finished', 'parent command finishes')
  await until(() => !alive(child), 'cleanup escalates to SIGKILL for the remaining descendant')
})

test('restart reuses session identity, rejects live restart and remove stops its process', { timeout: 20_000 }, async t => {
  const { manager, create, output } = fixture(t)
  const id = create("printf 'STARTED\\n'; sleep 120")
  const firstPid = manager.get(id).pid!
  await assert.rejects(manager.restart(id), /dừng phiên/)
  await manager.stop(id)
  await manager.restart(id)
  await until(() => (output.get(id)?.match(/STARTED/g)?.length ?? 0) >= 2, 'restarted command runs')
  const nextPid = manager.get(id).pid!
  assert.notEqual(nextPid, firstPid)
  assert.equal(manager.workspace.sessions.length, 1)
  assert.equal(manager.get(id).status, 'running')
  manager.workspace.layout = { view: 'terminal', activeId: id, splitId: id, groupId: null }
  await manager.remove(id)
  await until(() => !alive(nextPid), 'removed session process exits')
  assert.equal(manager.workspace.sessions.length, 0)
  assert.equal(manager.workspace.layout.activeId, null)
  assert.equal(manager.workspace.layout.splitId, null)
  assert.throws(() => manager.get(id), /Không tìm thấy/)
})

test('ten simultaneous sessions in three groups retain independent I/O and all shut down', { timeout: 30_000 }, async t => {
  const workspace = freshWorkspace()
  workspace.groups.push({ id: 'two', name: 'Dự án hai', color: '#abcdef' }, { id: 'three', name: 'Dự án ba', color: '#fedcba' })
  const { manager, create, output } = fixture(t, '/bin/bash', workspace)
  const ids = Array.from({ length: 10 }, (_, i) => create(`printf 'SESSION_${i}_ONLY\\n'; sleep 120`, {
    name: `Task ${i}`, groupId: workspace.groups[i % 3].id, kind: i % 2 ? 'agent' : 'terminal'
  }))
  await until(() => ids.every((id, i) => output.get(id)?.includes(`SESSION_${i}_ONLY`)), 'all ten tasks emit output')
  const pids = ids.map(id => manager.get(id).pid!)
  assert.equal(new Set(pids).size, 10)
  assert.ok(ids.every(id => manager.get(id).status === 'running'))
  for (const [i, id] of ids.entries()) {
    const snapshot = await manager.snapshot(id)
    assert.match(snapshot.data, new RegExp(`SESSION_${i}_ONLY`))
    assert.doesNotMatch(snapshot.data, new RegExp(`SESSION_${(i + 1) % 10}_ONLY`))
    assert.equal(manager.get(id).pid, pids[i])
  }
  await manager.shutdown()
  await until(() => pids.every(pid => !alive(pid)), 'all ten shell processes exit')
  assert.ok(ids.every(id => manager.get(id).status === 'stopped'))
})

test('restoring saved active sessions does not launch commands until explicit restart', { timeout: 20_000 }, async t => {
  const { dir } = fixture(t)
  const marker = join(dir, 'should-not-auto-start')
  const state = freshWorkspace()
  state.sessions.push({
    id: 'restored', name: 'Saved task', kind: 'agent', cwd: dir,
    command: `touch '${marker}'`, groupId: 'default', status: 'running',
    startedAt: new Date().toISOString(), pid: 99999999, detached: true
  })
  const store = new WorkspaceStore(join(dir, 'workspace.json'))
  store.save(state)
  const restored = fixture(t, '/bin/bash', store.load())
  await delay(200)
  assert.equal(existsSync(marker), false)
  assert.equal(restored.manager.get('restored').status, 'stopped')
  assert.equal(restored.manager.get('restored').pid, undefined)
  assert.equal((await restored.manager.snapshot('restored')).data, '')
  await restored.manager.restart('restored')
  await until(() => existsSync(marker), 'explicit restart launches saved command')
  await until(() => restored.manager.get('restored').status === 'finished', 'restarted saved command finishes')
})
