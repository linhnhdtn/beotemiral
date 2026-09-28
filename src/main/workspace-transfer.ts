import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { groupSchema, launchSchema } from './store'
import type { ImportResult, LaunchSpec, Session, Workspace, WorkspaceTransfer } from '../shared/types'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const transferSchema = z.object({
  version: z.literal(1),
  groups: z.array(groupSchema).min(1).max(200),
  sessions: z.array(launchSchema).max(2000),
  templates: z.array(launchSchema.omit({ groupId: true })).max(500).default([])
}).superRefine((data, ctx) => {
  const ids = new Set(data.groups.map(g => g.id))
  if (ids.size !== data.groups.length) ctx.addIssue({ code: 'custom', message: 'ID nhóm bị trùng.' })
  if (data.sessions.some(s => !ids.has(s.groupId))) ctx.addIssue({ code: 'custom', message: 'Phiên tham chiếu nhóm không tồn tại.' })
})

/** Accept exported configurations and older workspace.json files, discarding runtime state. */
export function parseWorkspaceTransfer(text: string): WorkspaceTransfer {
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('File cấu hình vượt quá 5 MB.')
  try { return transferSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ''))) }
  catch { throw new Error('File cấu hình không hợp lệ. Cần JSON phiên bản 1 gồm groups, sessions và các nhóm tham chiếu hợp lệ.') }
}

const launchSpec = (session: LaunchSpec): LaunchSpec => ({
  name: session.name, kind: session.kind, cwd: session.cwd, command: session.command, groupId: session.groupId
})

export function exportWorkspaceConfiguration(workspace: Workspace): WorkspaceTransfer {
  return {
    version: 1,
    groups: workspace.groups.map(g => ({ ...g })),
    sessions: workspace.sessions.map(launchSpec),
    templates: workspace.templates.map(({ name, kind, cwd, command }) => ({ name, kind, cwd, command }))
  }
}

/** Add a fully validated plan atomically, with fresh IDs and no launched commands. */
export function importWorkspaceConfiguration(workspace: Workspace, input: WorkspaceTransfer): ImportResult {
  const plan = transferSchema.parse(input)
  const groupIds = new Map(plan.groups.map(g => [g.id, randomUUID()]))
  const groups = plan.groups.map(g => ({ ...g, id: groupIds.get(g.id)!, collapsed: false }))
  const sessions: Session[] = plan.sessions.map(s => ({
    ...launchSpec(s), id: randomUUID(), groupId: groupIds.get(s.groupId)!,
    status: 'stopped', startedAt: new Date().toISOString(), detached: false, restored: true
  }))
  const templates = plan.templates.map(t => ({ ...t, id: randomUUID() }))
  workspace.groups.push(...groups)
  workspace.sessions.push(...sessions)
  workspace.templates.push(...templates)
  return { groups: groups.length, sessions: sessions.length, templates: templates.length }
}
