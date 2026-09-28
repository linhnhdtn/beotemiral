import { randomUUID } from 'node:crypto'
import type { Workspace } from '../shared/types'

/** Move only group membership; running PTYs and terminal history remain untouched. */
export function removeWorkspaceGroup(workspace: Workspace, id: string, targetId?: string): void {
  if (!workspace.groups.some(group => group.id === id)) throw new Error('Group does not exist.')
  const remaining = workspace.groups.filter(group => group.id !== id)
  if (targetId && !remaining.some(group => group.id === targetId)) throw new Error('Choose a different group to receive the sessions.')
  const target = remaining.find(group => group.id === targetId) ?? remaining[0] ?? {
    id: randomUUID(), name: 'General', color: '#55d6be'
  }
  if (remaining.length === 0) remaining.push(target)
  for (const session of workspace.sessions) if (session.groupId === id) session.groupId = target.id
  workspace.groups = remaining
  if (workspace.layout.groupId === id) workspace.layout.groupId = target.id
}
