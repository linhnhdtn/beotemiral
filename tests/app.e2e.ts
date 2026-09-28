import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'

const requirePackage = createRequire(resolve('package.json'))
const electronPath = requirePackage('electron') as string
const appPath = resolve('out/main/index.js')
let app: ElectronApplication
let appProcess: ChildProcess
let page: Page
let dataDir: string
const errors: string[] = []

async function openApp(): Promise<void> {
  app = await electron.launch({
    executablePath: electronPath, args: ['--no-sandbox', appPath],
    env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }
  })
  appProcess = app.process()
  page = await app.firstWindow()
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.harbor))
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
}
test.beforeAll(() => { dataDir = mkdtempSync(join(tmpdir(), 'task-harbor-e2e-')) })
test.afterAll(async () => {
  if (app && appProcess.exitCode === null) {
    await app.evaluate(({ app }) => app.quit()).catch(() => {})
    await app.close().catch(() => {})
  }
  rmSync(dataDir, { recursive: true, force: true })
})

test('real PTYs, groups, detached windows, background lifetime and restore', async () => {
  await openApp()
  await expect(page).toHaveTitle(/Task Harbor/)
  const initial = await page.evaluate(() => window.harbor.getState())
  expect(initial.sessions).toHaveLength(0)
  const ids = await page.evaluate(async () => {
    const api = window.harbor
    const backend = await api.createGroup('Backend', '#55d6be')
    const agents = await api.createGroup('AI Agents', '#b59bf7')
    await api.updateGroup('default', { name: 'Operations', color: '#eab56d' })
    await api.reorderGroups([agents, backend, 'default'])
    const state = await api.getState()
    const template = await api.saveTemplate({ name: 'Service check', command: 'sleep 120', kind: 'terminal', cwd: state.home })
    const sessions: string[] = []
    for (let i = 0; i < 10; i++) sessions.push(await api.createSession({
      name: i === 0 ? 'Agent · checkout review' : ['Build storefront', 'API development', 'Queue worker'][i % 3] + ` ${i}`,
      groupId: [agents, backend, 'default'][i % 3], kind: i % 3 === 0 ? 'agent' : 'terminal', cwd: state.home,
      command: i === 0 ? `printf '\\033[32mHello café ✓\\033[0m\\n'; read -r answer; printf 'ANSWER:%s\\n' "$answer"; sleep 120` : `printf 'Task ${i} ready\\n'; sleep 120`
    }))
    return { backend, agents, template, sessions }
  })
  await expect.poll(async () => (await page.evaluate(() => window.harbor.getState())).sessions.filter(s => s.status === 'running').length).toBe(10)
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true })
  const target = ids.sessions[0]
  await page.evaluate(async ({ id, groupId }) => {
    await window.harbor.updateSession(id, { name: 'Payment agent', groupId })
    await window.harbor.focusSession(id)
  }, { id: target, groupId: ids.backend })
  await expect.poll(async () => (await page.evaluate(id => window.harbor.attachTerminal(id), target)).data).toContain('Hello café ✓')
  await page.evaluate(id => window.harbor.writeTerminal(id, 'Checked ✓\r'), target)
  await expect.poll(async () => (await page.evaluate(id => window.harbor.attachTerminal(id), target)).data).toContain('ANSWER:Checked ✓')
  await page.evaluate(id => window.harbor.resizeTerminal(id, 92, 24), target)
  const oldPid = (await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.pid
  const newWindow = app.waitForEvent('window')
  await page.evaluate(id => window.harbor.detachSession(id), target)
  const detachedPage = await newWindow
  detachedPage.on('pageerror', e => errors.push(e.message))
  await detachedPage.waitForFunction(() => Boolean(window.harbor))
  await expect.poll(async () => (await detachedPage.evaluate(id => window.harbor.attachTerminal(id), target)).data).toContain('ANSWER:Checked ✓')
  await expect(page.evaluate(async id => {
    try { await window.harbor.writeTerminal(id, 'unexpected'); return false } catch { return true }
  }, target)).resolves.toBe(true)
  await detachedPage.screenshot({ path: 'test-results/detached.png' })
  await detachedPage.evaluate(id => window.harbor.dockSession(id), target).catch(() => {})
  await expect.poll(async () => (await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.detached).toBe(false)
  expect((await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.pid).toBe(oldPid)
  await page.evaluate(async ({ first, second }) => window.harbor.updateLayout({ view: 'terminal', activeId: first, splitId: second }), { first: target, second: ids.sessions[1] })
  await expect(page.locator('.xterm')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/split.png' })

  // Close-to-background and a second launch also work without a tray host.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
  process.kill(oldPid!, 0)
  await new Promise<void>((resolveExit, reject) => {
    const second = spawn(electronPath, ['--no-sandbox', appPath], { env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }, stdio: 'ignore' })
    second.on('error', reject)
    second.on('exit', code => code === 0 ? resolveExit() : reject(new Error(`Second instance exit ${code}`)))
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
  expect((await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.pid).toBe(oldPid)

  // Stop confirmation can be cancelled; quitting can be cancelled too.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox })
  expect(await page.evaluate(id => window.harbor.stopSession(id), target)).toBe(false)
  await page.evaluate(() => window.harbor.quit())
  expect((await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.status).toBe('running')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox })
  await page.evaluate(id => window.harbor.stopSession(id), target)
  await expect.poll(async () => (await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.status).toBe('stopped')
  await page.evaluate(id => window.harbor.restartSession(id), target)
  await expect.poll(async () => (await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.status).toBe('running')
  expect((await page.evaluate(() => window.harbor.getState())).sessions.find(s => s.id === target)!.pid).not.toBe(oldPid)
  const pids = (await page.evaluate(() => window.harbor.getState())).sessions.map(s => s.pid!)
  await page.evaluate(() => window.harbor.quit()).catch(() => {})
  await expect.poll(() => appProcess.exitCode).toBe(0)
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  expect(existsSync(join(dataDir, 'workspace.json'))).toBe(true)
  expect(JSON.parse(readFileSync(join(dataDir, 'workspace.json'), 'utf8')).groups[0].id).toBe(ids.agents)

  await openApp()
  const restored = await page.evaluate(() => window.harbor.getState())
  expect(restored.sessions).toHaveLength(10)
  expect(restored.sessions.every(s => s.restored && !s.pid && !s.detached && s.status === 'stopped')).toBe(true)
  expect(restored.templates[0].id).toBe(ids.template)
  expect(restored.layout.splitId).toBe(ids.sessions[1])
  expect(errors).toEqual([])
  await page.evaluate(() => window.harbor.quit()).catch(() => {})
  await expect.poll(() => appProcess.exitCode).toBe(0)
})
