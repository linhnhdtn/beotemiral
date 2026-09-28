import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

test('deleting from the editor confirms stopped and running sessions and preserves cancelled edits', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'harbor-delete-editor-'))
  const app = await electron.launch({
    executablePath: createRequire(resolve('package.json'))('electron') as string,
    args: ['--no-sandbox', resolve('out/main/index.js')],
    env: { ...process.env, SHELL: '/bin/sh', TASK_HARBOR_DATA_DIR: dataDir, TASK_HARBOR_NO_TRAY: '1' }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const state = () => page.evaluate(() => window.harbor.getState())
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa phiên', exact: true })
  const confirm = page.getByRole('alertdialog')
  // The editor must confirm in-app, never through the native message box.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => { throw new Error('Native prompt used') }) as typeof dialog.showMessageBox
  })
  try {
    await expect(page.locator('.sidebar')).toBeVisible()
    const ids = await page.evaluate(async () => {
      const create = (name: string, command: string) => window.harbor.createSession({ name, command, cwd: '/tmp', groupId: 'default', kind: 'terminal' })
      return { finished: await create('Phiên đã xong', 'printf done'), live: await create('Phiên đang chạy', 'sleep 120') }
    })
    await expect.poll(async () => (await state()).sessions.find(s => s.id === ids.finished)?.status).toBe('finished')
    await expect.poll(async () => (await state()).sessions.find(s => s.id === ids.live)?.status).toBe('running')
    const pid = (await state()).sessions.find(s => s.id === ids.live)!.pid!

    await page.getByLabel('Sửa terminal Phiên đã xong', { exact: true }).click()
    await editor.getByLabel('Tên phiên', { exact: true }).fill('Bản nháp chưa lưu')
    await editor.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await expect(confirm).toHaveAccessibleName('Xóa “Phiên đã xong”?')
    await expect(confirm.getByRole('button', { name: 'Hủy', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(editor.getByLabel('Tên phiên', { exact: true })).toHaveValue('Bản nháp chưa lưu')

    await editor.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await confirm.getByRole('button', { name: 'Hủy', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await expect(editor.getByLabel('Tên phiên', { exact: true })).toHaveValue('Bản nháp chưa lưu')
    expect((await state()).sessions.find(s => s.id === ids.finished)?.name).toBe('Phiên đã xong')

    await editor.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await confirm.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect((await state()).sessions.some(s => s.id === ids.finished)).toBe(false)
    expect((await state()).sessions.find(s => s.id === ids.live)?.pid).toBe(pid)

    await page.getByLabel('Sửa terminal Phiên đang chạy', { exact: true }).click()
    await page.screenshot({ path: 'test-results/session-editor-delete.png' })
    await editor.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await expect(confirm).toContainText('tiến trình con')
    await page.waitForTimeout(300) // let modal-in finish before the screenshot
    await page.screenshot({ path: 'test-results/session-editor-delete-confirm.png' })
    await confirm.getByRole('button', { name: 'Hủy', exact: true }).click()
    expect((await state()).sessions.find(s => s.id === ids.live)).toMatchObject({ status: 'running', pid })
    process.kill(pid, 0)

    await editor.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    await confirm.getByRole('button', { name: 'Dừng và xóa', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect.poll(async () => (await state()).sessions.length).toBe(0)
    await expect.poll(() => {
      try { process.kill(pid, 0); return false }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
    }).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox }).catch(() => {})
    await app.evaluate(({ app }) => app.quit()).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dataDir, { recursive: true, force: true })
  }
})
