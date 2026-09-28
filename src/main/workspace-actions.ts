import { launchSchema } from './store'
import type { Session, Workspace } from '../shared/types'

/** Reorder configuration only; the session object and its live PTY keep their identity. */
export function moveWorkspaceSession(workspace: Workspace, id: string, groupId: string, beforeId?: string): void {
  const session = workspace.sessions.find(s => s.id === id)
  if (!session) throw new Error('Terminal session not found.')
  const group = workspace.groups.find(g => g.id === groupId)
  if (!group) throw new Error('Group does not exist.')
  if (beforeId && !workspace.sessions.some(s => s.id === beforeId && s.groupId === groupId)) throw new Error('The drop position is no longer valid.')
  if (beforeId === id) return
  const ordered = workspace.sessions.filter(s => s.id !== id)
  const index = beforeId ? ordered.findIndex(s => s.id === beforeId) : ordered.map(s => s.groupId).lastIndexOf(groupId) + 1
  ordered.splice(index === 0 && !beforeId ? ordered.length : index, 0, session)
  session.groupId = groupId
  group.collapsed = false
  workspace.sessions = ordered
  if (workspace.layout.activeId === id && workspace.layout.groupId) workspace.layout.groupId = groupId
}

export function updateWorkspaceSession(workspace: Workspace, id: string, input: unknown): Session {
  const patch = launchSchema.partial().strict().parse(input)
  const session = workspace.sessions.find(s => s.id === id)
  if (!session) throw new Error('Terminal session not found.')
  launchSchema.parse({ ...session, ...patch })
  if (patch.groupId && !workspace.groups.some(g => g.id === patch.groupId)) throw new Error('Group does not exist.')
  const launchChanged = (patch.cwd !== undefined && patch.cwd !== session.cwd) || (patch.command !== undefined && patch.command !== session.command)
  if (patch.groupId && patch.groupId !== session.groupId) moveWorkspaceSession(workspace, id, patch.groupId)
  if (launchChanged && (session.status === 'running' || session.status === 'starting')) session.pendingLaunch = true
  Object.assign(session, patch)
  return session
}
