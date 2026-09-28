import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

test('switching groups restores each terminal and split without restarting sessions', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'harbor-group-navigation-'))
  const app = await electron.launch({
    executablePath: createRequire(resolve('package.json'))('electron') as string,
    args: ['--no-sandbox', resolve('out/main/index.js')],
    env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    const ids = await page.evaluate(async () => {
      const api = window.harbor
      await api.updateGroup('default', { name: 'Alpha' })
      const beta = await api.createGroup('Beta', '#78cbd8')
      await api.createGroup('Empty', '#78cbd8')
      const create = (name: string, groupId: string) => api.createSession({
        name, groupId, kind: 'terminal', cwd: '/tmp',
        command: "printf 'READY\\n'; while IFS= read -r line; do printf 'RESULT:%s\\n' \"$line\"; done"
      })
      return { a1: await create('Alpha 1', 'default'), a2: await create('Alpha 2', 'default'), b1: await create('Beta 1', beta), beta }
    })
    const state = () => page.evaluate(() => window.harbor.getState())
    const switchGroup = (name: string) => page.locator('.group-row').filter({ hasText: name }).locator('.nav-item').click()
    const pane = (name: string) => page.getByRole('region', { name: `Terminal ${name}`, exact: true })
    await expect.poll(async () => (await state()).sessions.filter(s => s.status === 'running').length).toBe(3)
    const processes = (await state()).sessions.map(({ id, pid, startedAt }) => ({ id, pid, startedAt }))

    // Opening a terminal from the global overview also remembers its own group.
    await page.locator('.card-open').filter({ hasText: 'Alpha 2' }).click()
    await page.getByLabel('Chia đôi terminal').selectOption(ids.a1)
    await expect(pane('Alpha 2')).toBeVisible()
    await expect(pane('Alpha 1')).toBeVisible()
    await switchGroup('Beta')
    await expect(pane('Beta 1')).toBeVisible()
    await expect(page.locator('.terminal-pane')).toHaveCount(1)
    await switchGroup('Alpha')
    await expect(pane('Alpha 2')).toBeVisible()
    await expect(pane('Alpha 1')).toBeVisible()
    expect((await state()).layout).toMatchObject({ view: 'terminal', groupId: 'default', activeId: ids.a2, splitId: ids.a1 })

    // Background output and partially typed input survive navigating away.
    await page.getByLabel('Đóng khung chia đôi').click()
    await expect(page.locator('.terminal-overlay')).toHaveCount(0)
    await pane('Alpha 2').locator('.xterm-helper-textarea').focus()
    await page.keyboard.insertText('gõ dở')
    await switchGroup('Beta')
    await switchGroup('Alpha')
    await expect(page.locator('.terminal-overlay')).toHaveCount(0)
    await expect(pane('Alpha 2').locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(async id => (await window.harbor.attachTerminal(id)).data, ids.a2)).toContain('RESULT:gõ dở')
    await switchGroup('Beta')
    await page.evaluate(id => window.harbor.writeTerminal(id, 'chạy nền\r'), ids.a2)
    await switchGroup('Alpha')
    await expect(pane('Alpha 2').locator('.xterm-screen')).toContainText('RESULT:chạy nền')
    expect((await state()).sessions.map(({ id, pid, startedAt }) => ({ id, pid, startedAt }))).toEqual(processes)
    expect((await state()).sessions.every(s => s.status === 'running')).toBe(true)

    // Remember a different tab; an empty group must not show another group's terminal.
    await page.getByRole('treeitem', { name: 'Alpha 1', exact: true }).locator('.tree-session-select').click()
    await switchGroup('Empty')
    await expect(page.getByRole('heading', { name: 'Nhóm này đang trống' })).toBeVisible()
    await expect(page.locator('.terminal-pane')).toHaveCount(0)
    await switchGroup('Alpha')
    await expect(pane('Alpha 1')).toBeVisible()
    await switchGroup('Alpha')
    await expect(pane('Alpha 1')).toBeVisible()

    // Moved and deleted remembered sessions must not restore a stale terminal.
    await switchGroup('Beta')
    await page.evaluate(({ id, groupId }) => window.harbor.updateSession(id, { groupId }), { id: ids.a1, groupId: ids.beta })
    await switchGroup('Alpha')
    await expect(pane('Alpha 2')).toBeVisible()
    await switchGroup('Beta')
    await page.evaluate(id => window.harbor.removeSession(id), ids.a2)
    await switchGroup('Alpha')
    await expect(page.getByRole('heading', { name: 'Nhóm này đang trống' })).toBeVisible()
    await page.locator('.sidebar>.nav-item').click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ app }) => app.quit()).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dataDir, { recursive: true, force: true })
  }
})
