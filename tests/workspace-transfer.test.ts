import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { freshWorkspace } from '../src/main/store'
import { exportWorkspaceConfiguration, importWorkspaceConfiguration, MAX_IMPORT_BYTES, parseWorkspaceTransfer } from '../src/main/workspace-transfer'
import type { WorkspaceTransfer } from '../src/shared/types'

function fixture() {
  const workspace = freshWorkspace()
  workspace.groups[0] = { id: 'default', name: 'Công việc tiếng Việt 🌿', color: '#55d6be', collapsed: true }
  workspace.groups.push({ id: 'second', name: '第二 nhóm', color: '#123456', collapsed: false })
  workspace.sessions = [
    { id: 'live-one', name: 'Trợ lý đang chạy', kind: 'agent', cwd: '/tmp/thư mục', command: 'printf "xin chào 🌿"', groupId: 'second',
      status: 'running', startedAt: 'yesterday', pid: 7001, detached: true, pendingLaunch: true },
    { id: 'live-two', name: 'Terminal số 2', kind: 'terminal', cwd: '/tmp', command: '', groupId: 'default',
      status: 'error', startedAt: 'today', endedAt: 'later', exitCode: 12, error: 'previous failure', restored: true, detached: false }
  ]
  workspace.templates = [{ id: 'template-one', name: 'Mẫu tiếng Việt', kind: 'agent', cwd: '/tmp', command: 'agent --help' }]
  workspace.layout = { view: 'terminal', groupId: 'second', activeId: 'live-one', splitId: 'live-two' }
  workspace.appearance.backgroundTransparency = 37
  return workspace
}

test('export contains ordered Unicode launch configuration without runtime, layout or appearance data', () => {
  const workspace = fixture()
  const before = structuredClone(workspace)
  const exported = exportWorkspaceConfiguration(workspace)
  assert.deepEqual(exported, {
    version: 1,
    groups: [
      { id: 'default', name: 'Công việc tiếng Việt 🌿', color: '#55d6be', collapsed: true },
      { id: 'second', name: '第二 nhóm', color: '#123456', collapsed: false }
    ],
    sessions: [
      { name: 'Trợ lý đang chạy', kind: 'agent', cwd: '/tmp/thư mục', command: 'printf "xin chào 🌿"', groupId: 'second' },
      { name: 'Terminal số 2', kind: 'terminal', cwd: '/tmp', command: '', groupId: 'default' }
    ],
    templates: [{ name: 'Mẫu tiếng Việt', kind: 'agent', cwd: '/tmp', command: 'agent --help' }]
  })
  assert.deepEqual(workspace, before)
  assert.deepEqual(parseWorkspaceTransfer(JSON.stringify(exported)), exported)
  assert.deepEqual(parseWorkspaceTransfer('\uFEFF' + JSON.stringify(exported)), exported)
})

test('legacy workspace JSON imports as configuration and strips all session runtime fields', () => {
  const legacy = fixture()
  const parsed = parseWorkspaceTransfer(JSON.stringify(legacy))
  assert.deepEqual(parsed, exportWorkspaceConfiguration(legacy))
  const oldFile = { ...legacy } as Partial<typeof legacy>
  delete oldFile.appearance
  delete oldFile.templates
  const parsedOlder = parseWorkspaceTransfer(JSON.stringify(oldFile))
  assert.deepEqual(parsedOlder.templates, [])
  assert.deepEqual(parsedOlder.groups, legacy.groups)
  assert.deepEqual(parsedOlder.sessions, parsed.sessions)
  assert.deepEqual(Object.keys(parsed).sort(), ['groups', 'sessions', 'templates', 'version'])
})

test('import appends stopped sessions with fresh IDs while retaining existing running objects and settings', () => {
  const source = fixture()
  const plan = parseWorkspaceTransfer(JSON.stringify(source))
  const planBefore = structuredClone(plan)
  const destination = fixture()
  const before = structuredClone(destination)
  const oldGroups = [...destination.groups]
  const oldSessions = [...destination.sessions]
  const oldTemplates = [...destination.templates]
  const layout = destination.layout
  const appearance = destination.appearance
  assert.deepEqual(importWorkspaceConfiguration(destination, plan), { groups: 2, sessions: 2, templates: 1 })
  assert.deepEqual(destination.groups.slice(0, oldGroups.length), before.groups)
  assert.deepEqual(destination.sessions.slice(0, oldSessions.length), before.sessions)
  assert.deepEqual(destination.templates.slice(0, oldTemplates.length), before.templates)
  oldGroups.forEach((group, index) => assert.equal(destination.groups[index], group))
  oldSessions.forEach((session, index) => assert.equal(destination.sessions[index], session))
  oldTemplates.forEach((template, index) => assert.equal(destination.templates[index], template))
  assert.equal(destination.layout, layout)
  assert.equal(destination.appearance, appearance)
  assert.deepEqual(destination.layout, before.layout)
  assert.deepEqual(destination.appearance, before.appearance)

  const importedGroups = destination.groups.slice(oldGroups.length)
  const importedSessions = destination.sessions.slice(oldSessions.length)
  const importedTemplates = destination.templates.slice(oldTemplates.length)
  assert.deepEqual(importedGroups.map(g => [g.name, g.color, g.collapsed]), source.groups.map(g => [g.name, g.color, false]))
  assert.deepEqual(importedSessions.map(s => [s.name, s.kind, s.cwd, s.command]), source.sessions.map(s => [s.name, s.kind, s.cwd, s.command]))
  assert.equal(importedSessions[0].groupId, importedGroups[1].id)
  assert.equal(importedSessions[1].groupId, importedGroups[0].id)
  assert.deepEqual(importedTemplates.map(({ id, ...configuration }) => configuration), plan.templates)
  const sourceIds = new Set([...source.groups, ...source.sessions, ...source.templates].map(item => item.id))
  const importedIds = [...importedGroups, ...importedSessions, ...importedTemplates].map(item => item.id)
  assert.equal(new Set(importedIds).size, importedIds.length)
  for (const id of importedIds) assert.equal(sourceIds.has(id), false)
  for (const session of importedSessions) {
    assert.equal(session.status, 'stopped')
    assert.equal(session.detached, false)
    assert.equal(session.restored, true)
    assert.equal(Number.isNaN(Date.parse(session.startedAt)), false)
    for (const field of ['pid', 'exitCode', 'endedAt', 'error', 'pendingLaunch']) assert.equal(Object.hasOwn(session, field), false)
  }
  assert.deepEqual(plan, planBefore)

  const normalized = exportWorkspaceConfiguration(destination)
  assert.deepEqual(normalized.sessions.slice(oldSessions.length).map(({ groupId, ...launch }) => launch), plan.sessions.map(({ groupId, ...launch }) => launch))
})

test('import never executes the commands supplied by the file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'harbor-import-'))
  try {
    const marker = join(directory, 'must-not-exist')
    const workspace = freshWorkspace()
    const command = `printf executed > "${marker}"`
    const plan: WorkspaceTransfer = {
      version: 1, groups: [{ id: 'source', name: 'Import', color: '#123456' }],
      sessions: [{ name: 'Potential command', kind: 'terminal', cwd: directory, command, groupId: 'source' }], templates: []
    }
    importWorkspaceConfiguration(workspace, parseWorkspaceTransfer(JSON.stringify(plan)))
    assert.equal(existsSync(marker), false)
    assert.equal(workspace.sessions[0].command, command)
    assert.equal(workspace.sessions[0].status, 'stopped')
    assert.equal(workspace.sessions[0].pid, undefined)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('exported and imported configuration objects are independent of their source', () => {
  const source = fixture()
  const original = structuredClone(source)
  const exported = exportWorkspaceConfiguration(source)
  exported.groups[0].name = 'Changed export'
  exported.sessions[0].name = 'Changed export'
  exported.templates[0].command = 'Changed export'
  assert.deepEqual(source, original)

  const destination = freshWorkspace()
  const plan = exportWorkspaceConfiguration(source)
  importWorkspaceConfiguration(destination, plan)
  const importedBefore = structuredClone(destination)
  plan.groups[0].name = 'Changed plan'
  plan.sessions[0].command = 'Changed plan'
  plan.templates[0].name = 'Changed plan'
  assert.deepEqual(destination, importedBefore)
  destination.groups[1].name = 'Changed destination'
  destination.sessions[0].cwd = '/changed'
  destination.templates[0].command = 'Changed destination'
  assert.deepEqual(source, original)
})

test('invalid import documents are rejected before changing any existing configuration', async t => {
  const valid = exportWorkspaceConfiguration(fixture())
  const documents: unknown[] = [
    null, [], {}, { ...valid, version: 2 }, { ...valid, version: '1' },
    { ...valid, groups: [] },
    { ...valid, groups: [valid.groups[0], { ...valid.groups[1], id: valid.groups[0].id }] },
    { ...valid, groups: [{ ...valid.groups[0], color: 'red' }] },
    { ...valid, groups: [{ ...valid.groups[0], collapsed: 'yes' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], groupId: 'missing' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], name: '' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], cwd: '' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], kind: 'unknown' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], command: 123 }] },
    { ...valid, templates: [{ ...valid.templates[0], command: null }] },
    { ...valid, groups: Array.from({ length: 201 }, (_, index) => ({ ...valid.groups[0], id: `group-${index}` })), sessions: [] },
    { ...valid, sessions: Array.from({ length: 2001 }, () => valid.sessions[0]) },
    { ...valid, templates: Array.from({ length: 501 }, () => valid.templates[0]) }
  ]
  for (const [index, document] of documents.entries()) {
    await t.test(`invalid document ${index}`, () => {
      const destination = fixture()
      const before = structuredClone(destination)
      const groups = destination.groups
      const sessions = destination.sessions
      const templates = destination.templates
      assert.throws(() => parseWorkspaceTransfer(JSON.stringify(document)))
      assert.throws(() => importWorkspaceConfiguration(destination, document as WorkspaceTransfer))
      assert.deepEqual(destination, before)
      assert.equal(destination.groups, groups)
      assert.equal(destination.sessions, sessions)
      assert.equal(destination.templates, templates)
    })
  }
})

test('malformed JSON and oversized UTF-8 files are rejected', () => {
  for (const text of ['', '{', '{"version":1,}', 'not JSON']) assert.throws(() => parseWorkspaceTransfer(text))
  const base = exportWorkspaceConfiguration(fixture())
  const padded = JSON.stringify({ ...base, unused: '🌿'.repeat(Math.ceil(MAX_IMPORT_BYTES / 4)) })
  assert.ok(padded.length < MAX_IMPORT_BYTES)
  assert.ok(Buffer.byteLength(padded, 'utf8') > MAX_IMPORT_BYTES)
  assert.throws(() => parseWorkspaceTransfer(padded), /5 MB/)
})
