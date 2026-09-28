export type SessionStatus = 'starting' | 'running' | 'finished' | 'stopped' | 'error'
export type SessionKind = 'terminal' | 'agent'
export interface Group { id: string; name: string; color: string; collapsed?: boolean }
export interface LaunchSpec { name: string; kind: SessionKind; cwd: string; command: string; groupId: string }
export interface Session extends LaunchSpec {
  id: string
  status: SessionStatus
  startedAt: string
  endedAt?: string
  pid?: number
  exitCode?: number
  error?: string
  detached: boolean
  restored?: boolean
  pendingLaunch?: boolean
}
export interface LaunchTemplate { id: string; name: string; kind: SessionKind; cwd: string; command: string }
export interface Layout { view: 'overview' | 'terminal'; groupId: string | null; activeId: string | null; splitId: string | null }
export const DEFAULT_BACKGROUND_TRANSPARENCY = 0
export interface Appearance { backgroundTransparency: number }
export interface Workspace {
  version: 1
  groups: Group[]
  sessions: Session[]
  templates: LaunchTemplate[]
  layout: Layout
  appearance: Appearance
}
export interface AppState extends Workspace { home: string; shell: string; warning?: string }
export interface TerminalSnapshot { data: string; seq: number; cols: number; rows: number }
export interface TerminalAttachment extends TerminalSnapshot { leaseId: string }
export interface TerminalOutput { id: string; data: string; seq: number }
export interface HarborAPI {
  getState(): Promise<AppState>
  onState(listener: (state: AppState) => void): () => void
  onOutput(listener: (output: TerminalOutput) => void): () => void
  createSession(spec: LaunchSpec): Promise<string>
  updateSession(id: string, patch: Partial<LaunchSpec>): Promise<void>
  moveSession(id: string, groupId: string, beforeId?: string): Promise<void>
  stopSession(id: string): Promise<boolean>
  restartSession(id: string): Promise<void>
  removeSession(id: string, confirmed?: boolean): Promise<boolean>
  attachTerminal(id: string): Promise<TerminalAttachment>
  releaseTerminal(id: string, leaseId: string): Promise<void>
  writeTerminal(id: string, data: string): Promise<void>
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>
  detachSession(id: string): Promise<void>
  dockSession(id: string): Promise<void>
  focusSession(id: string): Promise<void>
  createGroup(name: string, color: string): Promise<string>
  updateGroup(id: string, patch: { name?: string; color?: string; collapsed?: boolean }): Promise<void>
  reorderGroups(ids: string[]): Promise<void>
  removeGroup(id: string, targetGroupId?: string): Promise<void>
  saveTemplate(template: Omit<LaunchTemplate, 'id'>): Promise<string>
  removeTemplate(id: string): Promise<void>
  updateLayout(patch: Partial<Layout>): Promise<void>
  updateAppearance(patch: Partial<Appearance>): Promise<void>
  chooseDirectory(): Promise<string | null>
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  quit(): Promise<void>
}
declare global { interface Window { harbor: HarborAPI } }
