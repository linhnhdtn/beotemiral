import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { ChildProcess } from 'node:child_process'

const electronPath = createRequire(resolve('package.json'))('electron') as string
let app: ElectronApplication
let child: ChildProcess
let page: Page
let dataDir: string
let previousClipboard = ''
const errors: string[] = []
const getState = () => page.evaluate(() => window.harbor.getState())
const snapshot = (id: string) => page.evaluate(async value => (await window.harbor.attachTerminal(value)).data, id)

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'task-harbor-ui-'))
  app = await electron.launch({ executablePath: electronPath, args: ['--no-sandbox', resolve('out/main/index.js')], env: { ...process.env, TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' } })
  child = app.process()
  page = await app.firstWindow()
  previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  page.on('pageerror', e => errors.push(e.message))
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/tmp'] })) as typeof dialog.showOpenDialog
  })
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
})
test.afterAll(async () => {
  if (child?.exitCode === null) {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard)
    await page.evaluate(() => window.harbor.quit()).catch(() => {})
    await expect.poll(() => child.exitCode).not.toBeNull()
  }
  await app?.close().catch(() => {})
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('Vietnamese workspace forms, terminal keyboard, templates and navigation', async () => {
  test.setTimeout(90000)
  await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên nhóm', { exact: true }).fill('Dự án thử nghiệm')
  await dialog.getByRole('button', { name: 'Màu #c2a0ef', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await getState()).groups.some(g => g.name === 'Dự án thử nghiệm')).toBe(true)
  let group = (await getState()).groups.find(g => g.name === 'Dự án thử nghiệm')!
  expect(group.color).toBe('#c2a0ef')
  await page.getByRole('button', { name: 'Sửa nhóm Dự án thử nghiệm', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên nhóm', { exact: true }).fill('AI Studio')
  await dialog.getByRole('button', { name: 'Màu #78cbd8', exact: true }).click()
  await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  group = (await getState()).groups.find(g => g.id === group.id)!
  expect(group).toMatchObject({ name: 'AI Studio', color: '#78cbd8' })
  await page.locator('.group-row').filter({ hasText: 'AI Studio' }).hover()
  await page.getByRole('button', { name: 'Di chuyển nhóm AI Studio lên', exact: true }).click()
  await expect.poll(async () => (await getState()).groups[0].id).toBe(group.id)
  await page.locator('.group-row').filter({ hasText: 'AI Studio' }).locator('.nav-item').click()

  await page.keyboard.press('Control+Shift+T')
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'AI agent Agent CLI của bạn', exact: true }).click()
  await dialog.getByLabel('Tên phiên', { exact: true }).fill('Agent kiểm thử')
  await dialog.getByRole('button', { name: 'Chọn thư mục', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Thư mục làm việc', exact: true })).toHaveValue('/tmp')
  await dialog.getByRole('textbox', { name: 'Lệnh khởi chạy', exact: true }).fill("printf 'READY\\n'; read -r reply; printf 'RESULT:%s\\n' \"$reply\"; read -r clip; printf 'CLIP:%s\\n' \"$clip\"; read -r marker; printf 'KEY:%s\\n' \"$marker\"; sleep 120")
  await dialog.getByText('Lưu thành mẫu để sử dụng lần sau', { exact: true }).click()
  await page.screenshot({ path: 'test-results/new-session-form.png' })
  await dialog.getByRole('button', { name: 'Tạo phiên', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const target = (await getState()).sessions.find(s => s.name === 'Agent kiểm thử')!
  expect(target).toMatchObject({ kind: 'agent', cwd: '/tmp', groupId: group.id })
  await expect.poll(() => snapshot(target.id)).toContain('READY')
  await expect(page.locator('.terminal-overlay')).toHaveCount(0)
  const screen = await page.locator('.xterm-screen').boundingBox()
  const dimensions = await page.evaluate(id => window.harbor.attachTerminal(id), target.id)
  const cellWidth = screen!.width / dimensions.cols
  const firstRow = screen!.y + screen!.height / dimensions.rows / 2
  await page.mouse.move(screen!.x + 1, firstRow)
  await page.mouse.down()
  await page.mouse.move(screen!.x + cellWidth * 5 + 1, firstRow, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.press('Control+Shift+C')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('READY')
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('Xin chào Việt Nam')
  await page.keyboard.press('Enter')
  await expect.poll(() => snapshot(target.id)).toContain('RESULT:Xin chào Việt Nam')
  await app.evaluate(({ clipboard }) => clipboard.writeText('Dán dữ liệu tiếng Việt'))
  await page.keyboard.press('Control+Shift+V')
  await expect.poll(() => snapshot(target.id)).toContain('Dán dữ liệu tiếng Việt')
  await page.keyboard.press('Enter')
  await expect.poll(() => snapshot(target.id)).toContain('CLIP:Dán dữ liệu tiếng Việt')
  expect(await snapshot(target.id)).not.toContain('CLIP:Dán dữ liệu tiếng ViệtDán dữ liệu tiếng Việt')

  // Rename and move the running session using its menu.
  await page.getByLabel('Thao tác với Agent kiểm thử', { exact: true }).click()
  await page.getByRole('button', { name: 'Chỉnh sửa phiên', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên phiên', { exact: true }).fill('Agent thanh toán')
  await dialog.getByLabel('Nhóm', { exact: true }).selectOption('default')
  await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect.poll(async () => (await getState()).sessions.find(s => s.id === target.id)?.groupId).toBe('default')
  await page.locator('.sidebar>.nav-item').click()
  await page.getByRole('textbox', { name: 'Lọc phiên', exact: true }).fill('thanh toán')
  await expect(page.locator('.session-card')).toHaveCount(1)
  await page.locator('.segmented').getByRole('button', { name: 'AI agent', exact: true }).click()
  await expect(page.locator('.session-card.agent')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Lọc phiên', exact: true }).fill('không có kết quả')
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy phiên phù hợp', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Bỏ bộ lọc', exact: true }).click()

  // Launch a second session from the saved template, then remove the template.
  await page.getByRole('button', { name: /^Mẫu lệnh/ }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Mở mẫu Agent kiểm thử', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Tên phiên', { exact: true })).toHaveValue('Agent kiểm thử')
  await expect(dialog.getByRole('textbox', { name: 'Thư mục làm việc', exact: true })).toHaveValue('/tmp')
  await dialog.getByRole('button', { name: 'Terminal Shell & tác vụ thông thường', exact: true }).click()
  await dialog.getByLabel('Tên phiên', { exact: true }).fill('Terminal phụ')
  await dialog.getByLabel('Nhóm', { exact: true }).selectOption('default')
  await dialog.getByRole('textbox', { name: 'Lệnh khởi chạy', exact: true }).fill("printf 'SECOND READY\\n'; sleep 120")
  await dialog.getByRole('button', { name: 'Tạo phiên', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const second = (await getState()).sessions.find(s => s.name === 'Terminal phụ')!
  await expect.poll(() => snapshot(second.id)).toContain('SECOND READY')
  await page.getByRole('button', { name: /^Mẫu lệnh/ }).click()
  await page.getByRole('button', { name: 'Xóa mẫu Agent kiểm thử', exact: true }).click()
  await expect.poll(async () => (await getState()).templates.length).toBe(0)
  await page.keyboard.press('Escape')

  // Quick search focuses the correct real terminal; Ctrl+Tab remains a UI shortcut.
  await page.keyboard.press('Control+Shift+P')
  await page.getByRole('textbox', { name: 'Tìm nhanh phiên', exact: true }).fill('thanh toán')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await getState()).layout.activeId).toBe(target.id)
  await expect(page.getByRole('region', { name: 'Terminal Agent thanh toán', exact: true })).toBeVisible()
  await expect(page.locator('.terminal-overlay')).toHaveCount(0)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press('Control+Tab')
  await expect.poll(async () => (await getState()).layout.activeId).toBe(second.id)
  await expect(page.getByRole('region', { name: 'Terminal Terminal phụ', exact: true })).toBeVisible()
  await expect(page.locator('.terminal-overlay')).toHaveCount(0)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press('Control+Shift+Tab')
  await expect.poll(async () => (await getState()).layout.activeId).toBe(target.id)
  await expect(page.getByRole('region', { name: 'Terminal Agent thanh toán', exact: true })).toBeVisible()
  await expect(page.locator('.terminal-overlay')).toHaveCount(0)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('KEYCHECK')
  await page.keyboard.press('Enter')
  await expect.poll(() => snapshot(target.id)).toContain('KEY:KEYCHECK')
  await page.getByRole('combobox', { name: 'Chia đôi terminal', exact: true }).selectOption(second.id)
  await expect(page.locator('.xterm')).toHaveCount(2)
  await page.getByRole('button', { name: 'Đóng khung chia đôi', exact: true }).click()
  await expect(page.locator('.xterm')).toHaveCount(1)

  // A bad working directory reports a useful failure without leaving an active task.
  await page.keyboard.press('Control+Shift+T')
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên phiên', { exact: true }).fill('Thư mục không tồn tại')
  await dialog.getByRole('textbox', { name: 'Thư mục làm việc', exact: true }).fill('/tmp/task-harbor-definitely-not-a-directory')
  await dialog.getByRole('button', { name: 'Tạo phiên', exact: true }).click()
  await expect.poll(async () => Boolean(await dialog.locator('.form-error').count()) || (await getState()).sessions.some(s => s.name === 'Thư mục không tồn tại' && s.status === 'error')).toBe(true)
  await page.keyboard.press('Escape')
  await page.locator('.sidebar>.nav-item').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 650))
  await page.screenshot({ path: 'test-results/overview-940.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: /^Terminal mới/ })).toBeVisible()

  // Deleting a populated group transfers live and failed sessions without stopping work.
  const beforeMove = (await getState()).sessions.map(({ id, pid, status }) => ({ id, pid, status }))
  await page.getByRole('button', { name: 'Sửa nhóm Không gian chung', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Nhóm nhận phiên', exact: true }).selectOption(group.id)
  await dialog.getByRole('button', { name: 'Xóa nhóm', exact: true }).click()
  await expect.poll(async () => (await getState()).groups.some(g => g.id === 'default')).toBe(false)
  let transferred = await getState()
  expect(transferred.sessions.every(s => s.groupId === group.id)).toBe(true)
  expect(transferred.sessions.map(({ id, pid, status }) => ({ id, pid, status }))).toEqual(beforeMove)
  for (const s of transferred.sessions.filter(s => s.status === 'running')) process.kill(s.pid!, 0)

  // The final group can also be removed; sessions move into a new common group.
  await page.getByRole('button', { name: 'Sửa nhóm AI Studio', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Xóa nhóm', exact: true }).click()
  await expect.poll(async () => (await getState()).groups.some(g => g.id === group.id)).toBe(false)
  transferred = await getState()
  expect(transferred.groups).toHaveLength(1)
  expect(transferred.groups[0].name).toBe('Không gian chung')
  expect(transferred.sessions.every(s => s.groupId === transferred.groups[0].id)).toBe(true)
  expect(transferred.sessions.map(({ id, pid, status }) => ({ id, pid, status }))).toEqual(beforeMove)
  expect(errors).toEqual([])
})
