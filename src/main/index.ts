import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, clipboard } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WorkspaceStore, appearanceSchema, colorSchema, launchSchema, layoutSchema, nameSchema } from './store'
import { SessionManager, isLive } from './sessions'
import { removeWorkspaceGroup } from './groups'
import { moveWorkspaceSession, updateWorkspaceSession } from './workspace-actions'
import type { AppState, TerminalOutput } from '../shared/types'

app.setName('Task Harbor')
if (process.env.TASK_HARBOR_DATA_DIR) app.setPath('userData', process.env.TASK_HARBOR_DATA_DIR)
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
let quitPending = false
let store: WorkspaceStore
let manager: SessionManager
let saveTimer: NodeJS.Timeout | undefined
let warning: string | undefined
const detached = new Map<string, BrowserWindow>()
const subscribers = new Map<number, Map<string, string>>()
const idSchema = z.string().min(1).max(100)
const windowIds = new Set<number>()

function state(): AppState {
  return { ...manager.workspace, home: homedir(), shell: manager.shell, warning }
}
function save(): void {
  if (saveTimer) clearTimeout(saveTimer)
  try { store.save(manager.workspace) } catch (error) {
    warning = `Could not save configuration: ${String(error)}`
    broadcast()
  }
}
function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('harbor:state', state())
  }
}
function changed(): void {
  broadcast()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 200)
  updateTray()
}
function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
function updateTray(): void {
  if (!tray || tray.isDestroyed()) return
  const count = manager.workspace.sessions.filter(isLive).length
  tray.setToolTip(`Task Harbor · ${count} sessions running`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Task Harbor', click: showMain },
    { label: `${count} sessions running`, enabled: false },
    { type: 'separator' },
    { label: 'Quit completely', click: () => { void requestQuit() } }
  ]))
}
function createWindow(sessionId?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: sessionId ? 1080 : 1440, height: sessionId ? 720 : 900,
    minWidth: sessionId ? 640 : 940, minHeight: 600,
    title: sessionId ? `${manager.get(sessionId).name} — Task Harbor` : 'Task Harbor',
    transparent: true, backgroundColor: '#00000000', icon: join(app.getAppPath(), 'resources/icon.png'),
    show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  windowIds.add(window.webContents.id)
  const wcId = window.webContents.id
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  window.webContents.on('render-process-gone', () => { subscribers.delete(wcId) })
  window.on('ready-to-show', () => window.show())
  window.on('close', event => {
    if (quitting) return
    if (!sessionId) { event.preventDefault(); window.hide() }
  })
  window.on('closed', () => {
    windowIds.delete(wcId)
    subscribers.delete(wcId)
    if (sessionId) {
      detached.delete(sessionId)
      const session = manager.workspace.sessions.find(s => s.id === sessionId)
      if (session) {
        session.detached = false
        manager.workspace.layout = { ...manager.workspace.layout, view: 'terminal', activeId: sessionId }
        changed()
      }
      if (!quitting) showMain()
    }
  })
  const query: Record<string, string> = sessionId ? { session: sessionId } : {}
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (sessionId) url.searchParams.set('session', sessionId)
    void window.loadURL(url.toString())
  } else void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
  return window
}
async function confirm(window: BrowserWindow | null, message: string, detail: string, action: string): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'question', title: 'Task Harbor', message, detail,
    buttons: ['Cancel', action], defaultId: 0, cancelId: 0, noLink: true
  }
  const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return result.response === 1
}
async function requestQuit(): Promise<void> {
  if (quitPending || quitting) return
  quitPending = true
  try {
    const count = manager.workspace.sessions.filter(isLive).length
    if (count && !await confirm(mainWindow ?? null, `Stop ${count} sessions and quit?`, 'Running commands will be terminated. Groups, command templates and layout will be saved.', 'Stop and quit')) return
    await manager.shutdown()
    save()
    quitting = true
    app.quit()
  } catch (error) { warning = `Could not quit: ${String(error)}`; broadcast(); showMain() }
  finally { quitPending = false }
}

function registerIPC(): void {
  function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
    ipcMain.handle(`harbor:${channel}`, (event, ...args) => {
      if (quitPending && channel !== 'state') throw new Error('The app is shutting down.')
      if (!windowIds.has(event.sender.id) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid request source.')
      const source = new URL(event.senderFrame.url)
      const valid = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
        ? source.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
        : source.protocol === 'file:' && decodeURIComponent(source.pathname) === join(__dirname, '../renderer/index.html')
      if (!valid) throw new Error('Invalid request source.')
      return fn(event, ...args)
    })
  }
  function owner(event: Electron.IpcMainInvokeEvent, id: string): void {
    manager.get(id)
    const window = detached.get(id) ?? mainWindow
    if (window?.webContents.id !== event.sender.id) throw new Error('The session is open in another window.')
  }
  function group(id: string): void {
    if (!manager.workspace.groups.some(g => g.id === id)) throw new Error('Group does not exist.')
  }
  handle('state', () => state())
  handle('create-session', (_e, input) => {
    const spec = launchSchema.parse(input)
    group(spec.groupId)
    manager.workspace.groups.find(g => g.id === spec.groupId)!.collapsed = false
    return manager.create(spec)
  })
  handle('update-session', (_e, id, input) => {
    const session = updateWorkspaceSession(manager.workspace, idSchema.parse(id), input)
    detached.get(id)?.setTitle(`${session.name} — Task Harbor`)
    changed()
  })
  handle('move-session', (_e, id, groupId, beforeId) => {
    moveWorkspaceSession(manager.workspace, idSchema.parse(id), idSchema.parse(groupId), idSchema.optional().parse(beforeId))
    changed()
  })
  handle('stop-session', async (event, id) => {
    const session = manager.get(idSchema.parse(id))
    if (!isLive(session)) return true
    if (!await confirm(BrowserWindow.fromWebContents(event.sender), `Stop “${session.name}”?`, 'The running command and its child processes will be terminated.', 'Stop session')) return false
    await manager.stop(id)
    return true
  })
  handle('restart-session', async (_e, id) => { await manager.restart(idSchema.parse(id)) })
  handle('remove-session', async (event, id, confirmed) => {
    const session = manager.get(idSchema.parse(id))
    const live = isLive(session)
    // The editor confirms in-app; other callers still get the native prompt.
    if (confirmed !== true && !await confirm(BrowserWindow.fromWebContents(event.sender), `Delete “${session.name}”?`,
      live ? 'The session and its screen history will be deleted. The running command and its child processes will be stopped.' : 'The session and its screen history will be deleted. This cannot be undone.',
      live ? 'Stop and delete' : 'Delete session')) return false
    detached.get(id)?.close()
    await manager.remove(id)
    return true
  })
  handle('attach-terminal', async (event, input) => {
    const id = idSchema.parse(input)
    owner(event, id)
    const set = subscribers.get(event.sender.id) ?? new Map<string, string>()
    const leaseId = randomUUID()
    set.set(id, leaseId)
    subscribers.set(event.sender.id, set)
    return { ...await manager.snapshot(id), leaseId }
  })
  handle('release-terminal', (event, input, lease) => {
    const id = idSchema.parse(input)
    const subscriptions = subscribers.get(event.sender.id)
    if (subscriptions?.get(id) === idSchema.parse(lease)) subscriptions.delete(id)
  })
  handle('write-terminal', (event, input, value) => {
    const id = idSchema.parse(input)
    owner(event, id)
    manager.write(id, z.string().max(1024 * 1024).parse(value))
  })
  handle('resize-terminal', (event, input, cols, rows) => {
    const id = idSchema.parse(input)
    owner(event, id)
    const dimension = z.number().int().min(2).max(500)
    manager.resize(id, dimension.parse(cols), dimension.parse(rows))
  })
  handle('detach-session', (_e, input) => {
    const id = idSchema.parse(input)
    const session = manager.get(id)
    if (detached.has(id)) { detached.get(id)!.show(); detached.get(id)!.focus(); return }
    session.detached = true
    for (const set of subscribers.values()) set.delete(id)
    const window = createWindow(id)
    detached.set(id, window)
    changed()
  })
  handle('dock-session', (_e, input) => {
    const id = idSchema.parse(input)
    manager.get(id)
    detached.get(id)?.close()
  })
  handle('focus-session', (_e, input) => {
    const id = idSchema.parse(input)
    manager.get(id)
    const window = detached.get(id)
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
    else { manager.workspace.layout = { ...manager.workspace.layout, view: 'terminal', activeId: id }; changed(); showMain() }
  })
  handle('create-group', (_e, name, color) => {
    const id = randomUUID()
    manager.workspace.groups.push({ id, name: nameSchema.parse(name), color: colorSchema.parse(color) })
    changed()
    return id
  })
  handle('update-group', (_e, input, data) => {
    const id = idSchema.parse(input)
    group(id)
    const patch = z.object({ name: nameSchema.optional(), color: colorSchema.optional(), collapsed: z.boolean().optional() }).strict().parse(data)
    Object.assign(manager.workspace.groups.find(g => g.id === id)!, patch)
    changed()
  })
  handle('reorder-groups', (_e, input) => {
    const ids = z.array(idSchema).parse(input)
    const groups = manager.workspace.groups
    if (ids.length !== groups.length || new Set(ids).size !== groups.length || ids.some(id => !groups.some(g => g.id === id))) throw new Error('Invalid group order.')
    manager.workspace.groups = ids.map(id => groups.find(g => g.id === id)!)
    changed()
  })
  handle('remove-group', (_e, input, target) => {
    const id = idSchema.parse(input)
    removeWorkspaceGroup(manager.workspace, id, idSchema.optional().parse(target))
    changed()
  })
  handle('save-template', (_e, input) => {
    const template = launchSchema.omit({ groupId: true }).parse(input)
    const id = randomUUID()
    manager.workspace.templates.push({ ...template, id })
    changed()
    return id
  })
  handle('remove-template', (_e, input) => {
    const id = idSchema.parse(input)
    manager.workspace.templates = manager.workspace.templates.filter(t => t.id !== id)
    changed()
  })
  handle('update-layout', (_e, input) => {
    const patch = layoutSchema.partial().strict().parse(input)
    if (patch.groupId) group(patch.groupId)
    if (patch.activeId) manager.get(patch.activeId)
    if (patch.splitId) manager.get(patch.splitId)
    Object.assign(manager.workspace.layout, patch)
    changed()
  })
  handle('update-appearance', (_e, input) => {
    const patch = appearanceSchema.partial().strict().parse(input)
    Object.assign(manager.workspace.appearance, patch)
    changed()
  })
  handle('choose-directory', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, { title: 'Choose working directory', properties: ['openDirectory'], defaultPath: homedir() })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('read-clipboard', () => clipboard.readText())
  handle('write-clipboard', (_e, text) => { clipboard.writeText(z.string().max(1024 * 1024).parse(text)) })
  handle('quit', () => requestQuit())
}

app.on('second-instance', () => { if (manager) showMain() })
app.on('activate', () => { if (manager) showMain() })
app.on('window-all-closed', () => { /* Owned PTYs continue while the app is hidden. */ })
app.on('before-quit', event => {
  if (!quitting && manager) { event.preventDefault(); void requestQuit() }
})
if (hasLock) void app.whenReady().then(() => {
  store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))
  const workspace = store.load()
  warning = store.warning
  manager = new SessionManager(workspace, process.env.SHELL || '/bin/bash', id => [...subscribers.values()].some(set => set.has(id)))
  manager.on('changed', changed)
  manager.on('output', (output: TerminalOutput) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (subscribers.get(window.webContents.id)?.has(output.id)) window.webContents.send('harbor:output', output)
    }
  })
  registerIPC()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Task Harbor', submenu: [
      { label: 'Show main window', click: showMain },
      { label: 'Quit completely', accelerator: 'Ctrl+Shift+Q', click: () => { void requestQuit() } }
    ] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]))
  try {
    if (process.env.TASK_HARBOR_NO_TRAY !== '1') {
      const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/icons/32x32.png')).resize({ width: 24, height: 24 })
      tray = new Tray(icon)
      tray.on('click', showMain)
      updateTray()
    }
  } catch { warning = 'System tray unavailable. Launch Task Harbor again to return to running sessions.' }
  mainWindow = createWindow()
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    void manager.shutdown().finally(() => { save(); quitting = true; app.quit() })
  })
})
