import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore, freshWorkspace } from '../src/main/store'
import { DEFAULT_BACKGROUND_TRANSPARENCY, type Session } from '../src/shared/types'

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'task-harbor-appearance-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, file: join(dir, 'workspace.json') }
}

test('legacy workspaces gain an opaque background without losing saved work', t => {
  const { dir, file } = fixture(t)
  const { appearance: _appearance, ...legacy } = freshWorkspace()
  legacy.groups.unshift({ id: 'backend', name: 'Server', color: '#abcdef' })
  legacy.templates.push({ id: 'agent', name: 'Developer', kind: 'agent', cwd: '/tmp', command: 'codex --help' })
  const running: Session = {
    id: 'terminal', name: 'Running terminal', kind: 'terminal', cwd: '/tmp',
    command: 'printf ready; read -r answer', groupId: 'backend',
    status: 'running', startedAt: '2026-09-24T01:00:00.000Z', pid: 123456, detached: true
  }
  legacy.sessions.push(running)
  legacy.layout = { view: 'terminal', activeId: running.id, splitId: null, groupId: 'backend' }
  const original = JSON.stringify(legacy)
  writeFileSync(file, original)

  const store = new WorkspaceStore(file)
  const restored = store.load()
  assert.equal(DEFAULT_BACKGROUND_TRANSPARENCY, 0)
  assert.deepEqual(restored.appearance, { backgroundTransparency: 0 })
  assert.deepEqual(restored.groups, legacy.groups)
  assert.deepEqual(restored.templates, legacy.templates)
  assert.deepEqual(restored.layout, legacy.layout)
  assert.deepEqual(restored.sessions, [{
    ...running, status: 'stopped', pid: undefined, detached: false, restored: true
  }])
  assert.equal(store.warning, undefined)
  assert.deepEqual(readdirSync(dir), ['workspace.json'])
  assert.equal(readFileSync(file, 'utf8'), original, 'loading a legacy workspace does not rewrite it')

  store.save(restored)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).appearance.backgroundTransparency, 0)
  assert.deepEqual(new WorkspaceStore(file).load(), restored)
})

test('custom transparency and both endpoints survive saving and restoring', async t => {
  for (const value of [0, 37, 70, 100]) await t.test(`${value}% transparency`, child => {
    const { file } = fixture(child)
    const workspace = freshWorkspace()
    workspace.appearance.backgroundTransparency = value
    new WorkspaceStore(file).save(workspace)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).appearance, { backgroundTransparency: value })
    assert.equal(new WorkspaceStore(file).load().appearance.backgroundTransparency, value)
  })
})

test('invalid transparency never overwrites the last valid workspace', async t => {
  const cases: [string, unknown][] = [
    ['below zero', -1], ['above 100', 101], ['fraction', 70.5],
    ['NaN', NaN], ['infinity', Infinity], ['string', '70'],
    ['null', null], ['missing number', undefined], ['boolean', true], ['object', {}]
  ]
  for (const [name, value] of cases) await t.test(name, child => {
    const { dir, file } = fixture(child)
    const store = new WorkspaceStore(file)
    const workspace = freshWorkspace()
    workspace.appearance.backgroundTransparency = 42
    store.save(workspace)
    const saved = readFileSync(file, 'utf8')
    ;(workspace.appearance as { backgroundTransparency: unknown }).backgroundTransparency = value

    assert.throws(() => store.save(workspace))
    assert.equal(readFileSync(file, 'utf8'), saved)
    assert.equal(new WorkspaceStore(file).load().appearance.backgroundTransparency, 42)
    assert.deepEqual(readdirSync(dir), ['workspace.json'])
  })
})

test('fresh and migrated workspaces do not share their appearance defaults', t => {
  const { file } = fixture(t)
  const first = freshWorkspace()
  const second = freshWorkspace()
  assert.notEqual(first.appearance, second.appearance)
  first.appearance.backgroundTransparency = 12
  assert.equal(second.appearance.backgroundTransparency, 0)

  const { appearance: _appearance, ...legacy } = freshWorkspace()
  writeFileSync(file, JSON.stringify(legacy))
  const migrated = new WorkspaceStore(file).load()
  const another = new WorkspaceStore(file).load()
  assert.notEqual(migrated.appearance, another.appearance)
  migrated.appearance.backgroundTransparency = 99
  assert.equal(another.appearance.backgroundTransparency, 0)
  assert.equal(new WorkspaceStore(file).load().appearance.backgroundTransparency, 0)
})
