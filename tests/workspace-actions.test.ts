import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { freshWorkspace, WorkspaceStore } from '../src/main/store'
import { moveWorkspaceSession, updateWorkspaceSession } from '../src/main/workspace-actions'
import type { Session, SessionStatus } from '../src/shared/types'

const session = (id: string, groupId = 'default', status: SessionStatus = 'running'): Session => ({
  id, groupId, name: id, kind: 'terminal', cwd: '/tmp/original', command: 'sleep 60',
  status, pid: 321, startedAt: '2026-09-25T00:00:00.000Z', detached: true
})
function fixture() {
  const workspace = freshWorkspace()
  workspace.groups.push({ id: 'other', name: 'Dự án khác', color: '#667788', collapsed: true })
  workspace.groups.push({ id: 'empty', name: 'Nhóm trống', color: '#aabbcc', collapsed: true })
  workspace.sessions = [session('a'), session('x', 'other'), session('b'), session('y', 'other'), session('c')]
  workspace.layout = { view: 'terminal', groupId: 'default', activeId: 'b', splitId: 'a' }
  return workspace
}
const groupOrder = (workspace: ReturnType<typeof fixture>, id: string) => workspace.sessions.filter(s => s.groupId === id).map(s => s.id)

test('editing every launch field preserves the running session object, PID, timestamps and layout', () => {
  const workspace = fixture()
  const live = workspace.sessions[2]
  const result = updateWorkspaceSession(workspace, 'b', {
    name: 'Tác vụ đã sửa', kind: 'agent', cwd: '/tmp/thư mục mới', command: 'printf "xin chào"', groupId: 'other'
  })
  assert.equal(result, live)
  assert.equal(workspace.sessions.find(s => s.id === 'b'), live)
  assert.deepEqual(live, {
    id: 'b', name: 'Tác vụ đã sửa', kind: 'agent', cwd: '/tmp/thư mục mới', command: 'printf "xin chào"',
    groupId: 'other', status: 'running', pid: 321, startedAt: '2026-09-25T00:00:00.000Z',
    detached: true, pendingLaunch: true
  })
  assert.deepEqual(workspace.layout, { view: 'terminal', groupId: 'other', activeId: 'b', splitId: 'a' })
  assert.deepEqual(groupOrder(workspace, 'other'), ['x', 'y', 'b'])
})

test('only command or working-directory changes on live sessions require another launch', async t => {
  for (const status of ['starting', 'running', 'stopped', 'finished', 'error'] as const) {
    for (const patch of [{ command: 'different command' }, { cwd: '/tmp/different' }]) {
      await t.test(`${status}: ${Object.keys(patch)[0]}`, () => {
        const workspace = fixture()
        workspace.sessions[2].status = status
        updateWorkspaceSession(workspace, 'b', patch)
        assert.equal(workspace.sessions.find(s => s.id === 'b')!.pendingLaunch, status === 'starting' || status === 'running' ? true : undefined)
      })
    }
  }
  const workspace = fixture()
  const live = workspace.sessions[2]
  updateWorkspaceSession(workspace, 'b', { name: 'Tên mới', kind: 'agent', groupId: 'other' })
  assert.equal(live.pendingLaunch, undefined)
  updateWorkspaceSession(workspace, 'b', { cwd: live.cwd, command: live.command })
  assert.equal(live.pendingLaunch, undefined)
  updateWorkspaceSession(workspace, 'b', { command: '' })
  assert.equal(live.command, '')
  assert.equal(live.pendingLaunch, true)
  updateWorkspaceSession(workspace, 'b', { name: 'Đổi tên lần nữa' })
  assert.equal(live.pendingLaunch, true)
})

test('invalid edits are rejected atomically, including attempts to change runtime fields', async t => {
  const patches: unknown[] = [
    null, [], 'name', { name: '' }, { name: '   ' }, { name: 'x'.repeat(81) },
    { kind: 'shell' }, { cwd: '' }, { cwd: 'x'.repeat(4097) }, { command: 123 },
    { command: 'x'.repeat(16385) }, { groupId: 'missing', name: 'Would change' },
    { groupId: 'other', command: null }, { pid: 999 }, { status: 'stopped' },
    { name: undefined }, { kind: undefined }, { cwd: undefined }, { command: undefined }, { groupId: undefined }
  ]
  for (const [index, patch] of patches.entries()) {
    await t.test(`invalid patch ${index}`, () => {
      const workspace = fixture()
      const before = structuredClone(workspace)
      const identities = [...workspace.sessions]
      assert.throws(() => updateWorkspaceSession(workspace, 'b', patch))
      assert.deepEqual(workspace, before)
      assert.deepEqual(workspace.sessions.map((s, i) => s === identities[i]), identities.map(() => true))
    })
  }
  const workspace = fixture()
  const before = structuredClone(workspace)
  assert.throws(() => updateWorkspaceSession(workspace, 'missing', { name: 'New' }))
  assert.deepEqual(workspace, before)
})

test('moving before a visible terminal or appending gives the expected group order and preserves live identities', () => {
  const workspace = fixture()
  const identities = new Map(workspace.sessions.map(s => [s.id, s]))
  const snapshots = structuredClone(workspace.sessions)
  moveWorkspaceSession(workspace, 'c', 'default', 'a')
  assert.deepEqual(groupOrder(workspace, 'default'), ['c', 'a', 'b'])
  assert.deepEqual(groupOrder(workspace, 'other'), ['x', 'y'])
  moveWorkspaceSession(workspace, 'c', 'default')
  assert.deepEqual(groupOrder(workspace, 'default'), ['a', 'b', 'c'])
  moveWorkspaceSession(workspace, 'a', 'default', 'c')
  assert.deepEqual(groupOrder(workspace, 'default'), ['b', 'a', 'c'])
  for (const live of workspace.sessions) {
    assert.equal(live, identities.get(live.id))
    assert.deepEqual(live, snapshots.find(s => s.id === live.id))
  }
})

test('moving across groups expands the destination and follows the active terminal without changing split identity', () => {
  const workspace = fixture()
  const live = workspace.sessions[2]
  moveWorkspaceSession(workspace, 'b', 'other', 'y')
  assert.deepEqual(groupOrder(workspace, 'default'), ['a', 'c'])
  assert.deepEqual(groupOrder(workspace, 'other'), ['x', 'b', 'y'])
  assert.equal(workspace.groups[1].collapsed, false)
  assert.deepEqual(workspace.layout, { view: 'terminal', groupId: 'other', activeId: 'b', splitId: 'a' })
  assert.equal(workspace.sessions.find(s => s.id === 'b'), live)
  assert.equal(live.pid, 321)
  assert.equal(live.status, 'running')
  moveWorkspaceSession(workspace, 'b', 'empty')
  assert.deepEqual(groupOrder(workspace, 'empty'), ['b'])
  assert.deepEqual(groupOrder(workspace, 'other'), ['x', 'y'])
  assert.equal(workspace.groups[2].collapsed, false)
  assert.equal(workspace.layout.groupId, 'empty')
})

test('moving another terminal or moving in the global view does not change the selected group', () => {
  const workspace = fixture()
  moveWorkspaceSession(workspace, 'a', 'other')
  assert.equal(workspace.layout.groupId, 'default')
  assert.equal(workspace.layout.activeId, 'b')
  workspace.layout.groupId = null
  moveWorkspaceSession(workspace, 'b', 'empty')
  assert.equal(workspace.layout.groupId, null)
  assert.equal(workspace.layout.activeId, 'b')
})

test('invalid move targets and self moves leave the workspace unchanged', async t => {
  for (const [id, groupId, beforeId] of [
    ['missing', 'default', undefined], ['a', 'missing', undefined],
    ['a', 'other', 'missing'], ['a', 'other', 'b'], ['a', 'other', 'a']
  ]) {
    await t.test(`${id} -> ${groupId} before ${beforeId}`, () => {
      const workspace = fixture()
      const before = structuredClone(workspace)
      const list = workspace.sessions
      assert.throws(() => moveWorkspaceSession(workspace, id!, groupId!, beforeId))
      assert.deepEqual(workspace, before)
      assert.equal(workspace.sessions, list)
    })
  }
  const workspace = fixture()
  const before = structuredClone(workspace)
  moveWorkspaceSession(workspace, 'b', 'default', 'b')
  assert.deepEqual(workspace, before)
})

test('collapsed tree groups survive saving and loading alongside terminal configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'harbor-tree-'))
  try {
    const store = new WorkspaceStore(join(directory, 'workspace.json'))
    const workspace = fixture()
    workspace.groups[0].collapsed = false
    store.save(workspace)
    const restored = store.load()
    assert.equal(store.warning, undefined)
    assert.deepEqual(restored.groups, workspace.groups)
    assert.deepEqual(restored.sessions.map(s => [s.id, s.groupId, s.name]), workspace.sessions.map(s => [s.id, s.groupId, s.name]))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
