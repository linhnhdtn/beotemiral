import { contextBridge, ipcRenderer } from 'electron'
import type { HarborAPI, AppState, TerminalOutput } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`harbor:${channel}`, ...args)
const listen = <T>(channel: string, listener: (value: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(`harbor:${channel}`, handler)
  return () => { ipcRenderer.removeListener(`harbor:${channel}`, handler) }
}
const api: HarborAPI = {
  getState: () => invoke('state'),
  onState: listener => listen<AppState>('state', listener),
  onOutput: listener => listen<TerminalOutput>('output', listener),
  createSession: spec => invoke('create-session', spec),
  updateSession: (id, patch) => invoke('update-session', id, patch),
  moveSession: (id, groupId, beforeId) => invoke('move-session', id, groupId, beforeId),
  stopSession: id => invoke('stop-session', id),
  restartSession: id => invoke('restart-session', id),
  removeSession: (id, confirmed) => invoke('remove-session', id, confirmed === true),
  attachTerminal: id => invoke('attach-terminal', id),
  releaseTerminal: (id, leaseId) => invoke('release-terminal', id, leaseId),
  writeTerminal: (id, data) => invoke('write-terminal', id, data),
  resizeTerminal: (id, cols, rows) => invoke('resize-terminal', id, cols, rows),
  detachSession: id => invoke('detach-session', id),
  dockSession: id => invoke('dock-session', id),
  focusSession: id => invoke('focus-session', id),
  createGroup: (name, color) => invoke('create-group', name, color),
  updateGroup: (id, patch) => invoke('update-group', id, patch),
  reorderGroups: ids => invoke('reorder-groups', ids),
  removeGroup: (id, targetGroupId) => invoke('remove-group', id, targetGroupId),
  saveTemplate: template => invoke('save-template', template),
  removeTemplate: id => invoke('remove-template', id),
  updateLayout: patch => invoke('update-layout', patch),
  updateAppearance: patch => invoke('update-appearance', patch),
  chooseDirectory: () => invoke('choose-directory'),
  chooseImport: () => invoke('choose-import'),
  importWorkspace: token => invoke('import-workspace', token),
  exportWorkspace: () => invoke('export-workspace'),
  readClipboard: () => invoke('read-clipboard'),
  writeClipboard: text => invoke('write-clipboard', text),
  quit: () => invoke('quit')
}
contextBridge.exposeInMainWorld('harbor', api)
