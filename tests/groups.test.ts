import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshWorkspace } from '../src/main/store'
import { removeWorkspaceGroup } from '../src/main/groups'

test('deleting a group moves every session and keeps live identity, status and layout', () => {
  const workspace = freshWorkspace()
  workspace.groups.push({ id: 'other', name: 'Project', color: '#55d6be' })
  workspace.sessions.push({ id: 'live', name: 'Agent', groupId: 'default', kind: 'agent', cwd: '/tmp', command: 'sleep 60', pid: 123, status: 'running', startedAt: 'now', detached: true })
  const live = workspace.sessions[0]
  workspace.layout = { view: 'terminal', groupId: 'default', activeId: 'live', splitId: null }
  removeWorkspaceGroup(workspace, 'default', 'other')
  assert.deepEqual(workspace.groups.map(group => group.id), ['other'])
  assert.equal(workspace.sessions[0], live)
  assert.deepEqual(live, { id: 'live', name: 'Agent', groupId: 'other', kind: 'agent', cwd: '/tmp', command: 'sleep 60', pid: 123, status: 'running', startedAt: 'now', detached: true })
  assert.equal(workspace.layout.groupId, 'other')
  assert.equal(workspace.layout.activeId, 'live')
})

test('deleting the last group creates a usable common group', () => {
  const workspace = freshWorkspace()
  workspace.groups[0].name = 'Group to delete'
  removeWorkspaceGroup(workspace, 'default')
  assert.equal(workspace.groups.length, 1)
  assert.notEqual(workspace.groups[0].id, 'default')
  assert.equal(workspace.groups[0].name, 'General')
})

test('invalid or self-target deletion leaves the workspace unchanged', () => {
  const workspace = freshWorkspace()
  const before = structuredClone(workspace)
  assert.throws(() => removeWorkspaceGroup(workspace, 'default', 'default'))
  assert.throws(() => removeWorkspaceGroup(workspace, 'default', 'missing'))
  assert.throws(() => removeWorkspaceGroup(workspace, 'missing'))
  assert.deepEqual(workspace, before)
})
