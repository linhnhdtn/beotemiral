import { useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowUpRight, Bot, ChevronDown, ChevronRight, GripVertical, Pencil, Plus, SquareTerminal } from 'lucide-react'
import type { AppState, Group, Session } from '../../shared/types'
import './workspace-tree.css'

interface WorkspaceTreeProps {
  state: AppState
  selectedSessionId?: string
  onSelectGroup(group: Group): void
  onOpenSession(session: Session): void
  onEditGroup(group: Group): void
  onEditSession(session: Session): void
  onCreateSession(groupId: string): void
  onToggleGroup(group: Group): void
  onReorderGroups(ids: string[]): void
  onMoveSession(id: string, groupId: string, beforeId?: string): void
}

type Dragged = { kind: 'group' | 'session'; id: string }
type DropTarget = { kind: 'group' | 'session'; id: string; position: 'before' | 'after' | 'inside' }
type TreeNode = { key: string; group: Group; session?: Session }
const groupMime = 'application/x-task-harbor-group'
const sessionMime = 'application/x-task-harbor-session'
const statusLabels: Record<Session['status'], string> = { starting: 'Starting', running: 'Running', finished: 'Finished', stopped: 'Stopped', error: 'Error' }

export default function WorkspaceTree({
  state, selectedSessionId, onSelectGroup, onOpenSession, onEditGroup, onEditSession,
  onCreateSession, onToggleGroup, onReorderGroups, onMoveSession
}: WorkspaceTreeProps) {
  const dragged = useRef<Dragged | null>(null)
  const nodeElements = useRef(new Map<string, HTMLDivElement>())
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const sessionsByGroup = new Map<string, Session[]>()
  for (const session of state.sessions) {
    const sessions = sessionsByGroup.get(session.groupId) ?? []
    sessions.push(session)
    sessionsByGroup.set(session.groupId, sessions)
  }
  const visibleNodes: TreeNode[] = state.groups.flatMap(group => [
    { key: `group:${group.id}`, group },
    ...(group.collapsed ? [] : (sessionsByGroup.get(group.id) ?? []).map(session => ({ key: `session:${session.id}`, group, session })))
  ])
  const selectedNode = visibleNodes.find(node => node.session?.id === selectedSessionId)
    ?? visibleNodes.find(node => !node.session && node.group.id === state.layout.groupId)
  const tabKey = visibleNodes.some(node => node.key === focusedKey) ? focusedKey : selectedNode?.key ?? visibleNodes[0]?.key
  const focusNode = (key?: string) => {
    if (!key) return
    setFocusedKey(key)
    nodeElements.current.get(key)?.focus()
  }
  const registerNode = (key: string) => (element: HTMLDivElement | null) => {
    if (element) nodeElements.current.set(key, element)
    else nodeElements.current.delete(key)
  }
  const reorderGroup = (group: Group, direction: -1 | 1) => {
    const index = state.groups.findIndex(item => item.id === group.id)
    const target = index + direction
    if (target < 0 || target >= state.groups.length) return
    const ids = state.groups.map(item => item.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    onReorderGroups(ids)
    setAnnouncement(`Moved group ${group.name} ${direction < 0 ? 'up' : 'down'}.`)
  }
  const reorderSession = (session: Session, direction: -1 | 1) => {
    const sessions = sessionsByGroup.get(session.groupId) ?? []
    const index = sessions.findIndex(item => item.id === session.id)
    if (index + direction < 0 || index + direction >= sessions.length) return
    onMoveSession(session.id, session.groupId, sessions[index + (direction < 0 ? -1 : 2)]?.id)
    setAnnouncement(`Moved terminal ${session.name} ${direction < 0 ? 'up' : 'down'}.`)
  }
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button') && !target.closest('.tree-select')) return
    const element = target.closest<HTMLElement>('[data-tree-key]')
    const index = visibleNodes.findIndex(node => node.key === element?.dataset.treeKey)
    const node = visibleNodes[index]
    if (!node) return
    const key = event.key
    if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault()
      if (node.session) reorderSession(node.session, key === 'ArrowUp' ? -1 : 1)
      else reorderGroup(node.group, key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault()
      const next = key === 'Home' ? 0 : key === 'End' ? visibleNodes.length - 1 : index + (key === 'ArrowDown' ? 1 : -1)
      focusNode(visibleNodes[Math.max(0, Math.min(next, visibleNodes.length - 1))]?.key)
    } else if (key === 'ArrowRight' && !node.session) {
      event.preventDefault()
      if (node.group.collapsed) onToggleGroup(node.group)
      else if (visibleNodes[index + 1]?.session) focusNode(visibleNodes[index + 1].key)
    } else if (key === 'ArrowLeft') {
      event.preventDefault()
      if (node.session) focusNode(`group:${node.group.id}`)
      else if (!node.group.collapsed) onToggleGroup(node.group)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (node.session) onOpenSession(node.session)
      else onSelectGroup(node.group)
    } else if (key === 'F2') {
      event.preventDefault()
      if (node.session) onEditSession(node.session)
      else onEditGroup(node.group)
    }
  }
  const startDrag = (event: DragEvent, item: Dragged) => {
    dragged.current = item
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(item.kind === 'group' ? groupMime : sessionMime, item.id)
    event.stopPropagation()
  }
  const endDrag = () => { dragged.current = null; setDropTarget(null) }
  const dragOver = (event: DragEvent<HTMLDivElement>, kind: DropTarget['kind'], id: string) => {
    const item = dragged.current
    if (!item || (item.kind === 'group' && kind !== 'group') || (item.kind === kind && item.id === id)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position = item.kind === 'session' && kind === 'group' ? 'inside' : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget(previous => previous?.kind === kind && previous.id === id && previous.position === position ? previous : { kind, id, position })
  }
  const drop = (event: DragEvent, target: DropTarget) => {
    const item = dragged.current
    if (!item || (item.kind === 'group' && target.kind !== 'group')) return
    event.preventDefault()
    event.stopPropagation()
    if (item.kind === 'group') {
      const ids = state.groups.map(group => group.id).filter(id => id !== item.id)
      const index = ids.indexOf(target.id)
      if (index >= 0) {
        ids.splice(index + (target.position === 'after' ? 1 : 0), 0, item.id)
        onReorderGroups(ids)
        setAnnouncement('Group order changed.')
      }
    } else {
      const targetSession = target.kind === 'session' ? state.sessions.find(session => session.id === target.id) : undefined
      const groupId = target.kind === 'group' ? target.id : targetSession?.groupId
      if (groupId && item.id !== targetSession?.id) {
        const siblings = (sessionsByGroup.get(groupId) ?? []).filter(session => session.id !== item.id)
        const index = siblings.findIndex(session => session.id === targetSession?.id)
        const beforeId = target.position === 'before' ? targetSession?.id : target.position === 'after' ? siblings[index + 1]?.id : undefined
        onMoveSession(item.id, groupId, beforeId)
        setAnnouncement(`Moved terminal to group ${state.groups.find(group => group.id === groupId)?.name ?? ''}.`)
      }
    }
    endDrag()
  }
  const targetClass = (kind: DropTarget['kind'], id: string) => dropTarget?.kind === kind && dropTarget.id === id ? ` tree-drop-${dropTarget.position}` : ''
  const dropOnRow = (event: DragEvent, kind: DropTarget['kind'], id: string) => {
    if (dropTarget?.kind === kind && dropTarget.id === id) drop(event, dropTarget)
  }
  return <div className="workspace-tree">
    <div className="group-list tree-list" role="tree" aria-label="Groups and terminals" onKeyDown={handleKeys} onDragEnd={endDrag} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}>
      {state.groups.map(group => {
        const sessions = sessionsByGroup.get(group.id) ?? []
        const running = sessions.filter(session => session.status === 'running' || session.status === 'starting').length
        const groupKey = `group:${group.id}`
        return <div key={group.id} ref={registerNode(groupKey)} role="treeitem" aria-label={group.name} aria-expanded={!group.collapsed} aria-selected={state.layout.groupId === group.id && !selectedSessionId} tabIndex={tabKey === groupKey ? 0 : -1} data-tree-key={groupKey} className="tree-group-node" onFocus={event => { if (event.target === event.currentTarget) setFocusedKey(groupKey) }}>
          <div className={`group-row tree-group-row ${state.layout.groupId === group.id ? 'selected' : ''}${targetClass('group', group.id)}`} draggable onDragStart={event => startDrag(event, { kind: 'group', id: group.id })} onDragOver={event => dragOver(event, 'group', group.id)} onDrop={event => dropOnRow(event, 'group', group.id)}>
            <button className="icon-button tree-toggle" aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} group ${group.name}`} title={group.collapsed ? 'Expand group' : 'Collapse group'} onClick={() => onToggleGroup(group)}>{group.collapsed ? <ChevronRight size={17}/> : <ChevronDown size={17}/>}</button>
            <button className="nav-item tree-select" tabIndex={-1} title={`${group.name} · ${running}/${sessions.length} sessions running · Drag to reorder`} onClick={() => onSelectGroup(group)}><span className="group-dot" style={{ '--group-color': group.color } as CSSProperties}/><span>{group.name}</span><span className="nav-count">{sessions.length}</span></button>
            <div className="tree-row-tools">
              <button className="icon-button" aria-label={`New terminal in group ${group.name}`} title="New terminal in group" onClick={() => onCreateSession(group.id)}><Plus size={17}/></button>
              <button className="icon-button tree-edit" aria-label={`Edit group ${group.name}`} title="Edit group (F2)" onClick={() => onEditGroup(group)}><Pencil size={15}/></button>
            </div>
          </div>
          {!group.collapsed && <div role="group" className="tree-sessions">
            {sessions.map(session => {
              const sessionKey = `session:${session.id}`
              return <div key={session.id} ref={registerNode(sessionKey)} role="treeitem" aria-label={session.name} aria-selected={selectedSessionId === session.id} tabIndex={tabKey === sessionKey ? 0 : -1} data-tree-key={sessionKey} className={`tree-session-row ${selectedSessionId === session.id ? 'selected' : ''}${targetClass('session', session.id)}`} draggable onFocus={event => { if (event.target === event.currentTarget) setFocusedKey(sessionKey) }} onDragStart={event => startDrag(event, { kind: 'session', id: session.id })} onDragOver={event => dragOver(event, 'session', session.id)} onDrop={event => dropOnRow(event, 'session', session.id)}>
                <GripVertical className="tree-grip" size={14} aria-hidden="true"/>
                <button className="tree-select tree-session-select" tabIndex={-1} title={`${session.name}\n${session.cwd}\n${session.command || state.shell}\n${statusLabels[session.status]}${session.detached ? ' · Detached window' : ''}`} onClick={() => onOpenSession(session)}>
                  {session.kind === 'agent' ? <Bot className="tree-kind agent" size={15}/> : <SquareTerminal className="tree-kind" size={15}/>}
                  <span className="tree-session-text"><span>{session.name}</span></span>
                  {session.detached && <ArrowUpRight size={12} aria-label="Detached window"/>}
                  <i className={`tree-status ${session.status}`} aria-label={statusLabels[session.status]} title={statusLabels[session.status]}/>
                </button>
                <div className="tree-row-tools">
                  <button className="icon-button tree-edit" aria-label={`Edit terminal ${session.name}`} title="Edit terminal (F2)" onClick={() => onEditSession(session)}><Pencil size={15}/></button>
                </div>
              </div>
            })}
            {sessions.length === 0 && <button className="tree-empty" onClick={() => onCreateSession(group.id)}><Plus size={12}/>Add terminal</button>}
          </div>}
        </div>
      })}
    </div>
    <div className="tree-announcement" role="status" aria-live="polite">{announcement}</div>
  </div>
}
