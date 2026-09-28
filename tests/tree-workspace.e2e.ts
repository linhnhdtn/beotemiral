import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

test('workspace tree reorders visually, edits live terminal safely and persists collapsed groups', async () => {
  test.setTimeout(120000)
  const dataDir = mkdtempSync(join(tmpdir(), 'harbor-tree-workspace-'))
  const errors: string[] = []
  let app: ElectronApplication | undefined
  let page!: Page
  const executablePath = createRequire(resolve('package.json'))('electron') as string
  const getState = () => page.evaluate(() => window.harbor.getState())
  const groupNode = (name: string) => page.getByRole('treeitem', { name, exact: true }).filter({ has: page.locator('.tree-group-row') })
  const groupRow = (name: string) => groupNode(name).locator(':scope > .tree-group-row')
  const sessionNode = (name: string) => page.getByRole('treeitem', { name, exact: true }).and(page.locator('.tree-session-row'))
  const groupOrder = () => page.locator('.tree-list > .tree-group-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  const sessionOrder = (name: string) => groupNode(name).locator('.tree-session-row').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  const pane = (name: string) => page.getByRole('region', { name: `Terminal ${name}`, exact: true })
  const snapshot = (id: string) => page.evaluate(async id => {
    const attached = await window.harbor.attachTerminal(id)
    return attached.data
  }, id)

  async function launch() {
    app = await electron.launch({
      executablePath, args: ['--no-sandbox', resolve('out/main/index.js')],
      env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }
    })
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await expect(page.getByRole('tree', { name: 'Nhóm và terminal' })).toBeVisible()
  }

  async function drag(source: Locator, target: Locator, position: 'before' | 'after' | 'inside') {
    await source.hover()
    const from = await source.boundingBox()
    const to = await target.boundingBox()
    if (!from || !to) throw new Error('Drag source or target is missing')
    const x = to.x + Math.min(65, to.width / 2)
    const y = position === 'before' ? to.y + 4 : position === 'after' ? to.y + to.height - 4 : to.y + to.height / 2
    await page.mouse.move(from.x + 8, from.y + from.height / 2)
    await page.mouse.down()
    try {
      await page.mouse.move(from.x + 18, from.y + from.height / 2, { steps: 3 })
      await page.mouse.move(x, y, { steps: 12 })
      await page.mouse.move(x + 1, y)
      await expect(target).toHaveClass(new RegExp(`tree-drop-${position}`))
      const indicator = await target.evaluate((node, position) => {
        if (position === 'inside') return getComputedStyle(node).outlineStyle
        const style = getComputedStyle(node, position === 'before' ? '::before' : '::after')
        return `${style.height} ${style.content}`
      }, position)
      expect(position === 'inside' ? indicator === 'dashed' : indicator.startsWith('2px')).toBe(true)
    } finally {
      await page.mouse.up()
    }
  }

  try {
    await launch()
    const ids = await page.evaluate(async () => {
      const api = window.harbor
      await api.updateGroup('default', { name: 'Alpha' })
      const beta = await api.createGroup('Beta', '#78cbd8')
      const empty = await api.createGroup('Empty', '#c2a0ef')
      const create = (name: string, groupId: string) => api.createSession({
        name, kind: 'terminal', groupId, cwd: '/tmp',
        command: "printf 'READY\\n'; while IFS= read -r line; do printf 'RESULT:%s\\n' \"$line\"; done"
      })
      return {
        a1: await create('Alpha 1', 'default'), a2: await create('Alpha 2', 'default'),
        a3: await create('Alpha 3', 'default'), b1: await create('Beta 1', beta), beta, empty
      }
    })
    await expect.poll(async () => (await getState()).sessions.filter(session => session.status === 'running').length).toBe(4)
    await expect.poll(groupOrder).toEqual(['Alpha', 'Beta', 'Empty'])
    await expect.poll(() => sessionOrder('Alpha')).toEqual(['Alpha 1', 'Alpha 2', 'Alpha 3'])
    await expect(groupNode('Empty').getByRole('button', { name: 'Thêm terminal', exact: true })).toBeVisible()
    await expect(page.locator('.terminal-tabs')).toHaveCount(0)
    const before = (await getState()).sessions.map(({ id, pid, startedAt }) => ({ id, pid, startedAt }))

    await sessionNode('Alpha 1').locator('.tree-session-select').click()
    await expect(pane('Alpha 1')).toBeVisible()
    await expect(page.locator('.terminal-overlay')).toHaveCount(0)
    const input = await pane('Alpha 1').locator('.xterm-helper-textarea').elementHandle()
    if (!input) throw new Error('Terminal input missing')
    await input.focus()
    await page.keyboard.insertText('gõ dở trong cây')
    await page.getByLabel('Thu gọn nhóm Alpha', { exact: true }).click()
    await expect(groupNode('Alpha')).toHaveAttribute('aria-expanded', 'false')
    await expect(sessionNode('Alpha 1')).toHaveCount(0)
    await expect(pane('Alpha 1')).toBeVisible()
    expect(await input.evaluate(node => node.isConnected)).toBe(true)
    expect((await getState()).layout.activeId).toBe(ids.a1)
    await page.getByLabel('Mở nhóm Alpha', { exact: true }).click()
    await expect(sessionNode('Alpha 1')).toBeVisible()
    await input.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => snapshot(ids.a1)).toContain('RESULT:gõ dở trong cây')

    await drag(groupRow('Beta'), groupRow('Alpha'), 'before')
    await expect.poll(groupOrder).toEqual(['Beta', 'Alpha', 'Empty'])
    await drag(sessionNode('Alpha 3'), sessionNode('Alpha 1'), 'before')
    await expect.poll(() => sessionOrder('Alpha')).toEqual(['Alpha 3', 'Alpha 1', 'Alpha 2'])
    await drag(sessionNode('Alpha 3'), sessionNode('Alpha 2'), 'after')
    await expect.poll(() => sessionOrder('Alpha')).toEqual(['Alpha 1', 'Alpha 2', 'Alpha 3'])
    await drag(sessionNode('Alpha 3'), groupRow('Beta'), 'inside')
    await expect.poll(() => sessionOrder('Alpha')).toEqual(['Alpha 1', 'Alpha 2'])
    await expect.poll(() => sessionOrder('Beta')).toEqual(['Beta 1', 'Alpha 3'])
    await sessionNode('Alpha 3').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => sessionOrder('Beta')).toEqual(['Alpha 3', 'Beta 1'])
    await groupNode('Beta').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(groupOrder).toEqual(['Alpha', 'Beta', 'Empty'])
    await sessionNode('Alpha 2').hover()
    await page.getByLabel('Di chuyển terminal Alpha 2 lên', { exact: true }).click()
    await expect.poll(() => sessionOrder('Alpha')).toEqual(['Alpha 2', 'Alpha 1'])
    for (const process of before) {
      expect((await getState()).sessions.find(session => session.id === process.id)).toMatchObject(process)
    }
    await page.screenshot({ path: 'test-results/workspace-tree-populated.png', omitBackground: true })

    // All fields can change while the original shell continues to run.
    await page.getByLabel('Sửa terminal Alpha 1', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Chỉnh sửa phiên', exact: true })).toBeVisible()
    const modal = page.locator('.modal')
    const newCommand = "printf 'RESTARTED:%s\\n' \"$PWD\"; while IFS= read -r line; do printf 'NEW:%s\\n' \"$line\"; done"
    await modal.getByLabel('Tên phiên', { exact: true }).fill('Agent đã sửa')
    await modal.getByRole('button', { name: /AI agent/ }).click()
    await modal.getByLabel('Nhóm', { exact: true }).selectOption(ids.beta)
    await modal.getByLabel('Thư mục làm việc', { exact: true }).fill(dataDir)
    await modal.getByLabel('Lệnh khởi chạy', { exact: true }).fill(newCommand)
    await expect(modal.getByText('Lệnh và thư mục mới áp dụng khi bạn chạy lại phiên. Tác vụ hiện tại vẫn tiếp tục chạy.', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/workspace-session-editor.png', omitBackground: true })
    await modal.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
    await expect(modal).toHaveCount(0)
    await expect.poll(async () => (await getState()).sessions.find(session => session.id === ids.a1)).toMatchObject({
      name: 'Agent đã sửa', kind: 'agent', groupId: ids.beta, cwd: dataDir,
      command: newCommand, status: 'running', pid: before.find(session => session.id === ids.a1)!.pid,
      pendingLaunch: true
    })
    await expect(pane('Agent đã sửa')).toBeVisible()
    expect(await input.evaluate(node => node.isConnected)).toBe(true)
    await input.focus()
    await page.keyboard.insertText('sau khi sửa')
    await page.keyboard.press('Enter')
    await expect.poll(() => snapshot(ids.a1)).toContain('RESULT:sau khi sửa')
    expect(await snapshot(ids.a1)).not.toContain('RESTARTED:')

    await pane('Agent đã sửa').getByLabel('Thao tác với Agent đã sửa', { exact: true }).click()
    await pane('Agent đã sửa').getByRole('button', { name: 'Dừng phiên', exact: true }).click()
    await expect.poll(async () => (await getState()).sessions.find(session => session.id === ids.a1)?.status).toBe('stopped')
    await pane('Agent đã sửa').getByRole('button', { name: 'Chạy lại', exact: true }).click()
    await expect.poll(async () => (await getState()).sessions.find(session => session.id === ids.a1)?.status).toBe('running')
    const restarted = (await getState()).sessions.find(session => session.id === ids.a1)!
    expect(restarted.pid).not.toBe(before.find(session => session.id === ids.a1)!.pid)
    expect(restarted.pendingLaunch).toBeFalsy()
    await expect.poll(() => snapshot(ids.a1)).toContain(`RESTARTED:${dataDir}`)

    await page.getByLabel('Thu gọn nhóm Beta', { exact: true }).click()
    await expect(pane('Agent đã sửa')).toBeVisible()
    const persisted = await getState()
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'workspace.json'), 'utf8')).groups.find((group: { id: string }) => group.id === ids.beta)?.collapsed).toBe(true)
    const nativeWindow = await app!.browserWindow(page)
    await nativeWindow.evaluate(window => window.setSize(900, 720))
    await page.screenshot({ path: 'test-results/workspace-tree-narrow.png', omitBackground: true })
    expect(await page.locator('.sidebar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const process = app!.process()
    await page.evaluate(() => window.harbor.quit()).catch(() => {})
    await expect.poll(() => process.exitCode).toBe(0)
    await app!.close().catch(() => {})
    app = undefined

    await launch()
    const restored = await getState()
    expect(restored.groups).toEqual(persisted.groups)
    expect(restored.sessions.map(session => ({ id: session.id, groupId: session.groupId }))).toEqual(persisted.sessions.map(session => ({ id: session.id, groupId: session.groupId })))
    expect(restored.sessions.every(session => session.status === 'stopped')).toBe(true)
    await expect(groupNode('Beta')).toHaveAttribute('aria-expanded', 'false')
    await expect(sessionNode('Agent đã sửa')).toHaveCount(0)
    await page.getByLabel('Mở nhóm Beta', { exact: true }).click()
    await expect.poll(() => sessionOrder('Beta')).toEqual(['Alpha 3', 'Beta 1', 'Agent đã sửa'])
    await sessionNode('Agent đã sửa').focus()
    await page.keyboard.press('F2')
    await expect(page.locator('.modal').getByLabel('Lệnh khởi chạy', { exact: true })).toHaveValue(newCommand)
    await expect(page.locator('.modal').getByLabel('Thư mục làm việc', { exact: true })).toHaveValue(dataDir)
    expect(errors).toEqual([])
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.quit()).catch(() => {})
      await app.close().catch(() => {})
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
})
