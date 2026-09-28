import { _electron as electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const isDeb = process.argv.includes('--deb')
const format = isDeb ? 'DEB' : 'AppImage'
const artifact = isDeb
  ? resolve('release/deb', `Task-Harbor-${manifest.version}-amd64.deb`)
  : resolve(manifest.build.directories.output, `Task-Harbor-${manifest.version}-x86_64.AppImage`)
if (!existsSync(artifact)) throw new Error(`Run npm run ${isDeb ? 'dist:deb' : 'dist'} before testing ${format}.`)
const dataDir = mkdtempSync(join(tmpdir(), 'harbor-package-'))
function trayItems() {
  try {
    const output = execFileSync('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return [...output.matchAll(/'([^']+)'/g)].map(match => match[1])
  } catch { return null }
}
const before = process.env.TASK_HARBOR_NO_TRAY === '1' ? null : trayItems()
let app
let child
try {
  // Extract the actual package without installing it or changing the user's workspace.
  let executablePath
  if (isDeb) {
    execFileSync('dpkg-deb', ['--extract', artifact, join(dataDir, 'deb')], { stdio: 'ignore' })
    executablePath = join(dataDir, 'deb/opt/Task Harbor/task-harbor')
  } else {
    // The bundled AppImage runtime requires FUSE; extraction also works on hosts without it.
    execFileSync(artifact, ['--appimage-extract'], { cwd: dataDir, stdio: 'ignore' })
    executablePath = join(dataDir, 'squashfs-root/AppRun')
  }
  app = await electron.launch({ executablePath, args: ['--no-sandbox'], env: { ...process.env, TASK_HARBOR_DATA_DIR: join(dataDir, 'workspace'), TASK_HARBOR_NO_TRAY: process.env.TASK_HARBOR_NO_TRAY || '0' }, timeout: 45000 })
  child = app.process()
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('tree', { name: 'Groups and terminals', exact: true })).toBeVisible()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(manifest.version)
  const id = await page.evaluate(async () => {
    const state = await window.harbor.getState()
    const id = await window.harbor.createSession({ name: 'Packaged build check', groupId: state.groups[0].id, kind: 'terminal', cwd: state.home, command: "printf '\\033[32mPackaged build works\\033[0m\\n'; read -r line; printf 'INPUT:%s\\n' \"$line\"" })
    await window.harbor.focusSession(id)
    return id
  })
  const snapshot = async () => (await page.evaluate(id => window.harbor.attachTerminal(id), id)).data
  await expect.poll(snapshot).toContain('Packaged build works')
  await expect(page.locator('.terminal-overlay')).toHaveCount(0)
  await expect(page.getByRole('treeitem', { name: 'Packaged build check', exact: true })).toBeVisible()
  await expect(page.getByLabel('Edit terminal Packaged build check', { exact: true })).toBeVisible()
  await expect(page.locator('.terminal-tabs')).toHaveCount(0)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('packaging succeeded')
  await page.keyboard.press('Enter')
  await expect.poll(snapshot).toContain('INPUT:packaging succeeded')
  await expect.poll(async () => (await page.evaluate(() => window.harbor.getState())).sessions[0].status).toBe('finished')

  let trayVerified = false
  if (before !== null) {
    let entry
    await expect.poll(() => { entry = trayItems()?.find(item => !before.includes(item)); return Boolean(entry) }).toBe(true)
    const [bus, path = '/StatusNotifierItem'] = entry.split('@')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    execFileSync('gdbus', ['call', '--session', '--dest', bus, '--object-path', path, '--method', 'org.kde.StatusNotifierItem.Activate', '0', '0'], { stdio: 'pipe' })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    trayVerified = true
  }
  expect(errors).toEqual([])
  await page.screenshot({ path: `test-results/packaged${isDeb ? '-deb' : ''}.png` })
  await page.evaluate(() => window.harbor.quit()).catch(() => {})
  await expect.poll(() => child.exitCode).toBe(0)
  console.log(JSON.stringify({ artifact, packaged: true, realPty: true, unicodeKeyboard: true, trayVerified, cleanExit: true }))
} finally {
  if (app && child?.exitCode === null) {
    await app.evaluate(({ dialog, app }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      app.quit()
    }).catch(() => {})
    await app.close().catch(() => {})
  }
  rmSync(dataDir, { recursive: true, force: true })
}
