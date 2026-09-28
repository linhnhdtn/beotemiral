import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { DEFAULT_BACKGROUND_TRANSPARENCY, type Workspace } from '../shared/types'

export const nameSchema = z.string().trim().min(1).max(80)
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const groupSchema = z.object({ id: z.string().min(1).max(100), name: nameSchema, color: colorSchema, collapsed: z.boolean().optional() })
export const launchSchema = z.object({
  name: nameSchema, kind: z.enum(['terminal', 'agent']),
  cwd: z.string().min(1).max(4096), command: z.string().max(16384), groupId: z.string().min(1)
})
export const appearanceSchema = z.object({ backgroundTransparency: z.number().int().min(0).max(100) })
export const layoutSchema = z.object({
  view: z.enum(['overview', 'terminal']), groupId: z.string().nullable(),
  activeId: z.string().nullable(), splitId: z.string().nullable()
})
const sessionSchema = launchSchema.extend({
  id: z.string(), status: z.enum(['starting', 'running', 'finished', 'stopped', 'error']),
  startedAt: z.string(), endedAt: z.string().optional(), pid: z.number().optional(),
  exitCode: z.number().optional(), error: z.string().optional(), detached: z.boolean(), restored: z.boolean().optional(), pendingLaunch: z.boolean().optional()
})
const workspaceSchema = z.object({
  version: z.literal(1),
  groups: z.array(groupSchema).min(1),
  sessions: z.array(sessionSchema),
  templates: z.array(launchSchema.omit({ groupId: true }).extend({ id: z.string() })),
  layout: layoutSchema,
  appearance: appearanceSchema.default({ backgroundTransparency: DEFAULT_BACKGROUND_TRANSPARENCY })
}).superRefine((state, ctx) => {
  for (const items of [state.groups, state.sessions, state.templates]) {
    if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'ID trùng lặp' })
  }
  if (state.sessions.some(s => !state.groups.some(g => g.id === s.groupId))) ctx.addIssue({ code: 'custom', message: 'Nhóm không tồn tại' })
})

export function freshWorkspace(): Workspace {
  return {
    version: 1, groups: [{ id: 'default', name: 'Không gian chung', color: '#55d6be' }],
    sessions: [], templates: [], layout: { view: 'overview', groupId: null, activeId: null, splitId: null },
    appearance: { backgroundTransparency: DEFAULT_BACKGROUND_TRANSPARENCY }
  }
}

export class WorkspaceStore {
  warning?: string
  constructor(readonly file: string) {}
  load(): Workspace {
    if (!existsSync(this.file)) return freshWorkspace()
    try {
      const state = workspaceSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      state.sessions = state.sessions.map(s => ({
        ...s, pid: undefined, detached: false, restored: true,
        status: s.status === 'running' || s.status === 'starting' ? 'stopped' : s.status
      }))
      const ids = new Set(state.sessions.map(s => s.id))
      if (!ids.has(state.layout.activeId ?? '')) state.layout.activeId = null
      if (!ids.has(state.layout.splitId ?? '')) state.layout.splitId = null
      if (!state.groups.some(g => g.id === state.layout.groupId)) state.layout.groupId = null
      return state
    } catch {
      this.warning = 'Không đọc được cấu hình cũ. Đã mở không gian mới; bản cũ được giữ lại để khôi phục.'
      try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}`) } catch {
        this.warning = 'Không đọc được cấu hình. Không thể sao lưu tệp cũ; hãy kiểm tra quyền ghi thư mục dữ liệu.'
      }
      return freshWorkspace()
    }
  }
  save(state: Workspace): void {
    workspaceSchema.parse(state)
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(temp, this.file)
  }
}
