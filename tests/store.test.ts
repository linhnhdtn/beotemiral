import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore, freshWorkspace } from '../src/main/store'
import type { Session, Workspace } from '../src/shared/types'

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'task-harbor-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, file: join(dir, 'workspace.json') }
}

function session(status: Session['status'], id = status): Session {
  return {
    id, name: `Session ${id}`, kind: 'agent', cwd: '/tmp', command: 'codex', groupId: 'default',
    status, startedAt: '2026-09-21T01:00:00.000Z', pid: 123456,
    detached: true, ...(status === 'finished' ? { exitCode: 0 } : {})
  }
}

test('a new workspace is usable without creating a file', t => {
  const { dir, file } = fixture(t)
  const store = new WorkspaceStore(file)
  assert.deepEqual(store.load(), freshWorkspace())
  assert.equal(store.warning, undefined)
  assert.deepEqual(readdirSync(dir), [])
  const first = store.load()
  first.groups[0].name = 'Changed'
  assert.equal(store.load().groups[0].name, 'General')
})

test('persists group order, colors, Unicode templates and layout; restores sessions without live PIDs', t => {
  const { dir, file } = fixture(t)
  const state = freshWorkspace()
  state.groups.unshift({ id: 'backend', name: 'Server', color: '#abcdef' })
  state.templates.push({ id: 'agent', name: 'Developer', kind: 'agent', cwd: '/tmp', command: 'codex --help' })
  state.sessions = (['running', 'starting', 'finished', 'stopped', 'error'] as const).map(status => session(status))
  state.layout = { view: 'terminal', activeId: 'running', splitId: 'finished', groupId: 'backend' }
  const store = new WorkspaceStore(file)
  store.save(state)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), state)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir), ['workspace.json'])
  const restored = new WorkspaceStore(file).load()
  assert.deepEqual(restored.groups, state.groups)
  assert.deepEqual(restored.templates, state.templates)
  assert.deepEqual(restored.layout, state.layout)
  assert.deepEqual(restored.sessions.map(s => s.status), ['stopped', 'stopped', 'finished', 'stopped', 'error'])
  assert.ok(restored.sessions.every(s => s.pid === undefined && !s.detached && s.restored))
  assert.equal(restored.sessions[2].exitCode, 0)
  assert.equal(state.sessions[0].status, 'running', 'saving must not mutate the live workspace')
})

test('clears layout references to sessions or groups that no longer exist', t => {
  const { file } = fixture(t)
  const state = freshWorkspace()
  state.layout = { view: 'terminal', activeId: 'missing', splitId: 'missing', groupId: 'missing' }
  new WorkspaceStore(file).save(state)
  assert.deepEqual(new WorkspaceStore(file).load().layout, {
    view: 'terminal', activeId: null, splitId: null, groupId: null
  })
})

test('preserves malformed JSON as a recovery copy and starts a fresh workspace', t => {
  const { dir, file } = fixture(t)
  const content = '{"groups": broken'
  writeFileSync(file, content)
  const store = new WorkspaceStore(file)
  assert.deepEqual(store.load(), freshWorkspace())
  assert.match(store.warning ?? '', /previous configuration/)
  const backups = readdirSync(dir).filter(name => name.startsWith('workspace.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), content)
  store.save(freshWorkspace())
  assert.equal(readdirSync(dir).length, 2, 'a later save preserves the recovery copy')
})

test('rejects invalid persisted structures and retains their original bytes for recovery', async t => {
  const cases: [string, (state: Workspace) => void][] = [
    ['duplicate groups', state => state.groups.push({ ...state.groups[0] })],
    ['duplicate sessions', state => { state.sessions = [session('finished'), session('finished')] }],
    ['unknown session group', state => { state.sessions = [{ ...session('finished'), groupId: 'absent' }] }],
    ['missing groups', state => { state.groups = [] }],
    ['invalid color', state => { state.groups[0].color = 'red' }],
    ['unknown version', state => { (state as unknown as { version: number }).version = 20 }]
  ]
  for (const [name, mutate] of cases) await t.test(name, child => {
    const { dir, file } = fixture(child)
    const state = freshWorkspace()
    mutate(state)
    const content = JSON.stringify(state)
    writeFileSync(file, content)
    const store = new WorkspaceStore(file)
    assert.deepEqual(store.load(), freshWorkspace())
    assert.ok(store.warning)
    const backup = readdirSync(dir).find(name => name.startsWith('workspace.json.corrupt-'))!
    assert.equal(readFileSync(join(dir, backup), 'utf8'), content)
  })
})

test('a rejected save does not overwrite the last valid workspace', t => {
  const { file } = fixture(t)
  const store = new WorkspaceStore(file)
  const state = freshWorkspace()
  store.save(state)
  const before = readFileSync(file, 'utf8')
  state.groups[0].name = ''
  assert.throws(() => store.save(state))
  assert.equal(readFileSync(file, 'utf8'), before)
})
