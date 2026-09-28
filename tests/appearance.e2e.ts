import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

test('background transparency changes live, preserves terminals and survives restarting', async () => {
  test.setTimeout(90000)
  const dataDir = mkdtempSync(join(tmpdir(), 'harbor-appearance-ui-'))
  const errors: string[] = []
  let app: ElectronApplication | undefined
  let page!: Page
  async function launch() {
    app = await electron.launch({
      executablePath: createRequire(resolve('package.json'))('electron') as string,
      args: ['--no-sandbox', resolve('out/main/index.js')],
      env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }
    })
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await expect(page.locator('.app')).toBeVisible()
  }
  async function pixels(target: Page, selector: string, text = false) {
    const bounds = await target.locator(selector).boundingBox()
    if (!bounds) throw new Error('Missing surface: ' + selector)
    const rect = text
      ? { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y), width: Math.floor(bounds.width), height: Math.floor(bounds.height) }
      : { x: Math.floor(bounds.x + bounds.width - 4), y: Math.floor(bounds.y + bounds.height - 4), width: 1, height: 1 }
    const native = await app!.browserWindow(target)
    return native.evaluate(async (win, rect) => {
      const image = await win.webContents.capturePage(rect)
      const bitmap = image.toBitmap()
      let maxAlpha = 0
      for (let index = 3; index < bitmap.length; index += 4) maxAlpha = Math.max(maxAlpha, bitmap[index])
      return { alpha: bitmap[3], maxAlpha }
    }, rect)
  }
  const getState = () => page.evaluate(() => window.harbor.getState())
  try {
    await launch()
    expect((await getState()).appearance.backgroundTransparency).toBe(70)
    await expect.poll(async () => (await pixels(page, '.overview')).alpha).toBeGreaterThanOrEqual(74)
    expect((await pixels(page, '.overview')).alpha).toBeLessThanOrEqual(80)
    expect((await pixels(page, '.brand strong', true)).maxAlpha).toBeGreaterThan(240)
    await page.getByLabel('Giao diện', { exact: true }).click()
    const slider = page.getByRole('slider', { name: 'Độ trong suốt nền', exact: true })
    await expect(slider).toHaveValue('70')
    await page.screenshot({ path: 'test-results/transparency-70.png', omitBackground: true })
    await slider.press('Home')
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(0)
    await expect.poll(async () => (await pixels(page, '.overview')).alpha).toBe(255)
    await slider.press('End')
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(100)
    await expect.poll(async () => (await pixels(page, '.overview')).alpha).toBe(0)
    await page.getByRole('button', { name: 'Mặc định 70%', exact: true }).click()
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(70)
    await page.getByLabel('Giao diện', { exact: true }).click()

    const id = await page.evaluate(async () => {
      const id = await window.harbor.createSession({
        name: 'Trong suốt', kind: 'terminal', cwd: '/tmp', groupId: 'default',
        command: "printf 'READY\\n'; while IFS= read -r line; do printf 'RESULT:%s\\n' \"$line\"; done"
      })
      await window.harbor.focusSession(id)
      return id
    })
    await expect(page.locator('.terminal-overlay')).toHaveCount(0)
    await expect.poll(async () => (await getState()).sessions.find(s => s.id === id)?.status).toBe('running')
    const pid = (await getState()).sessions.find(s => s.id === id)!.pid
    const input = await page.locator('.xterm-helper-textarea').elementHandle()
    if (!input) throw new Error('Missing terminal input')
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.insertText('đang gõ dở')
    await page.getByLabel('Giao diện', { exact: true }).click()
    await slider.press('ArrowLeft')
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(69)
    await page.getByLabel('Giao diện', { exact: true }).click()
    expect(await input.evaluate(element => element.isConnected)).toBe(true)
    expect((await getState()).sessions.find(s => s.id === id)?.pid).toBe(pid)
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(async id => (await window.harbor.attachTerminal(id)).data, id)).toContain('RESULT:đang gõ dở')
    await expect.poll(async () => (await pixels(page, '.xterm-screen')).alpha).toBeGreaterThanOrEqual(76)
    expect((await pixels(page, '.xterm-screen')).alpha).toBeLessThanOrEqual(82)

    const windowOpened = app!.waitForEvent('window')
    await page.evaluate(id => window.harbor.detachSession(id), id)
    const detached = await windowOpened
    detached.on('pageerror', error => errors.push(error.message))
    await expect(detached.locator('.app')).toBeVisible()
    await expect(detached.locator('.terminal-overlay')).toHaveCount(0)
    expect((await detached.evaluate(() => window.harbor.getState())).appearance.backgroundTransparency).toBe(69)
    await detached.getByLabel('Giao diện', { exact: true }).click()
    await detached.getByRole('slider', { name: 'Độ trong suốt nền', exact: true }).press('Home')
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(0)
    await expect.poll(async () => (await pixels(detached, '.xterm-screen')).alpha).toBe(255)
    await detached.getByRole('button', { name: 'Mặc định 70%', exact: true }).click()
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(70)
    await detached.getByRole('slider', { name: 'Độ trong suốt nền', exact: true }).press('ArrowRight')
    await expect.poll(async () => (await getState()).appearance.backgroundTransparency).toBe(71)
    expect((await getState()).sessions.find(s => s.id === id)?.pid).toBe(pid)

    const rejected = await page.evaluate(async () => {
      const values: unknown[] = [
        { backgroundTransparency: -1 }, { backgroundTransparency: 101 },
        { backgroundTransparency: 50.5 }, { backgroundTransparency: '70' },
        { backgroundTransparency: null }, { backgroundTransparency: 70, unexpected: true }
      ]
      return Promise.all(values.map(async value => {
        try { await window.harbor.updateAppearance(value as { backgroundTransparency: number }); return false }
        catch { return true }
      }))
    })
    expect(rejected).toEqual([true, true, true, true, true, true])
    expect((await getState()).appearance.backgroundTransparency).toBe(71)
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'workspace.json'), 'utf8')).appearance.backgroundTransparency).toBe(71)
    const process = app!.process()
    await page.evaluate(() => window.harbor.quit()).catch(() => {})
    await expect.poll(() => process.exitCode).toBe(0)
    await app!.close().catch(() => {})
    app = undefined
    await launch()
    expect((await getState()).appearance.backgroundTransparency).toBe(71)
    await page.getByLabel('Giao diện', { exact: true }).click()
    await expect(page.getByRole('slider', { name: 'Độ trong suốt nền', exact: true })).toHaveValue('71')
    expect((await getState()).sessions.find(s => s.id === id)?.status).toBe('stopped')
    expect(errors).toEqual([])
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.quit()).catch(() => {})
      await app.close().catch(() => {})
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
})
