import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { WorkspaceTransfer } from '../src/shared/types'

test('import previews configuration, keeps work running, and round-trips portable exports', async () => {
  test.setTimeout(90000)
  const fixtureDir = mkdtempSync(join(tmpdir(), 'harbor-transfer-ui-'))
  const dataDir = join(fixtureDir, 'user-data')
  const invalidFile = join(fixtureDir, 'invalid.json')
  const importFile = join(fixtureDir, 'legacy-project.json')
  const exportFile = join(fixtureDir, 'exported-project.json')
  const executionMarker = join(fixtureDir, 'import-command-ran')
  const command = `touch '${executionMarker}'`
  const runtimeSecret = 'RUNTIME-ONLY-DIAGNOSTIC-MUST-NOT-EXPORT'
  writeFileSync(invalidFile, '{ broken JSON')
  writeFileSync(importFile, JSON.stringify({
    version: 1,
    groups: [
      { id: 'legacy-dev', name: 'Dự án được nhập', color: '#79dfbc', collapsed: true },
      { id: 'legacy-empty', name: 'Nhóm trống được nhập', color: '#93afff' }
    ],
    sessions: [
      { id: 'legacy-terminal', name: 'Terminal từ cấu hình', kind: 'terminal', cwd: fixtureDir, command, groupId: 'legacy-dev', status: 'running', pid: 123456789, detached: true, startedAt: '2025-01-01T00:00:00.000Z', error: runtimeSecret, output: runtimeSecret },
      { id: 'legacy-agent', name: 'Agent từ cấu hình', kind: 'agent', cwd: fixtureDir, command: 'printf "Agent chưa chạy\\n"', groupId: 'legacy-dev', status: 'running', pid: 987654321, detached: true }
    ],
    templates: [{ id: 'legacy-template', name: 'Mẫu từ cấu hình', kind: 'terminal', cwd: fixtureDir, command: 'printf "Template chưa chạy\\n"' }],
    layout: { view: 'terminal', groupId: 'legacy-dev', activeId: 'legacy-terminal', splitId: null },
    appearance: { backgroundTransparency: 25 },
    runtimeSecret
  }))
  const errors: string[] = []
  let app: ElectronApplication | undefined
  let page!: Page
  const getState = () => page.evaluate(() => window.harbor.getState())
  async function chooseDialogFile(path: string | null) {
    await app!.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: path === null, filePaths: path === null ? [] : [path]
      })) as typeof dialog.showOpenDialog
    }, path)
  }
  async function saveDialogFile(path: string | null) {
    await app!.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({
        canceled: path === null, filePath: path === null ? undefined : path
      })) as typeof dialog.showSaveDialog
    }, path)
  }
  try {
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
    const existingId = await page.evaluate(async cwd => {
      const state = await window.harbor.getState()
      const id = await window.harbor.createSession({
        name: 'Tác vụ đang làm', kind: 'terminal', cwd, groupId: state.groups[0].id,
        command: "printf 'EXISTING READY\\n'; while IFS= read -r line; do printf 'EXISTING:%s\\n' \"$line\"; done"
      })
      await window.harbor.focusSession(id)
      return id
    }, fixtureDir)
    await expect.poll(async () => (await getState()).sessions.find(session => session.id === existingId)?.status).toBe('running')
    const baseline = await getState()
    const originalPid = baseline.sessions.find(session => session.id === existingId)!.pid
    expect(originalPid).toBeGreaterThan(0)
    const assertExistingWork = async () => {
      const state = await getState()
      expect(state.sessions.find(session => session.id === existingId)).toMatchObject({ pid: originalPid, status: 'running' })
      expect(state.sessions.filter(session => session.status === 'running').map(session => session.id)).toEqual([existingId])
      expect(existsSync(executionMarker)).toBe(false)
      process.kill(originalPid!, 0)
    }

    await page.getByRole('button', { name: 'Nhập / Xuất cấu hình', exact: true }).click()
    const transfer = page.locator('.workspace-transfer')
    await expect(transfer).toBeVisible()
    await chooseDialogFile(null)
    await transfer.getByRole('button', { name: 'Chọn file JSON', exact: true }).click()
    await expect(transfer).toHaveAttribute('aria-busy', 'false')
    await expect(transfer.getByRole('button', { name: 'Nhập cấu hình', exact: true })).toHaveCount(0)
    expect(await getState()).toEqual(baseline)

    await chooseDialogFile(invalidFile)
    await transfer.getByRole('button', { name: 'Chọn file JSON', exact: true }).click()
    await expect(transfer.getByRole('alert')).toContainText('File cấu hình không hợp lệ')
    await expect(transfer.getByRole('button', { name: 'Nhập cấu hình', exact: true })).toHaveCount(0)
    expect(await getState()).toEqual(baseline)

    await chooseDialogFile(importFile)
    await transfer.getByRole('button', { name: 'Chọn file JSON', exact: true }).click()
    const preview = transfer.getByRole('region', { name: 'Xem trước cấu hình', exact: true })
    await expect(preview).toBeVisible()
    await expect(transfer.getByRole('alert')).toHaveCount(0)
    await expect(preview.getByText('legacy-project.json', { exact: true })).toBeVisible()
    await expect(preview).toContainText('2 nhóm · 2 phiên · 1 mẫu lệnh')
    for (const name of ['Dự án được nhập', 'Nhóm trống được nhập', 'Terminal từ cấu hình', 'Agent từ cấu hình', 'Mẫu từ cấu hình']) {
      await expect(preview.getByText(name, { exact: true })).toBeVisible()
    }
    await expect(preview.getByText('AI agent', { exact: true })).toBeVisible()
    expect(await preview.locator('code').allTextContents()).toEqual([fixtureDir, fixtureDir, fixtureDir])
    expect(await preview.locator('pre').allTextContents()).toEqual([
      command, 'printf "Agent chưa chạy\\n"', 'printf "Template chưa chạy\\n"'
    ])
    await expect(transfer).not.toContainText(runtimeSecret)
    expect(await getState()).toEqual(baseline)
    await assertExistingWork()
    await expect(transfer.getByRole('button', { name: 'Nhập cấu hình', exact: true })).toBeInViewport()
    await page.screenshot({ path: 'test-results/workspace-transfer-preview.png', fullPage: true })
    const nativeWindow = await app.browserWindow(page)
    await nativeWindow.evaluate(window => window.setSize(940, 650))
    await expect(transfer.getByRole('button', { name: 'Nhập cấu hình', exact: true })).toBeInViewport()
    await page.screenshot({ path: 'test-results/workspace-transfer-narrow.png', fullPage: true })

    await transfer.getByRole('button', { name: 'Nhập cấu hình', exact: true }).click()
    await expect(transfer.getByRole('status')).toContainText('Đã thêm 2 nhóm, 2 phiên và 1 mẫu lệnh.')
    const imported = await getState()
    expect(imported.groups.slice(0, baseline.groups.length)).toEqual(baseline.groups)
    expect(imported.groups).toHaveLength(baseline.groups.length + 2)
    expect(imported.groups.every(group => !group.id.startsWith('legacy-'))).toBe(true)
    expect(imported.sessions).toHaveLength(3)
    expect(imported.sessions.slice(1).map(session => session.name)).toEqual(['Terminal từ cấu hình', 'Agent từ cấu hình'])
    for (const session of imported.sessions.slice(1)) {
      expect(session).toMatchObject({ status: 'stopped', detached: false, restored: true })
      expect(session.pid).toBeUndefined()
      expect(session.error).toBeUndefined()
      expect(session.id).not.toMatch(/^legacy-/)
      expect(imported.groups.some(group => group.id === session.groupId && group.name === 'Dự án được nhập')).toBe(true)
    }
    expect(imported.templates).toHaveLength(1)
    expect(imported.templates[0].id).not.toBe('legacy-template')
    expect(imported.layout).toEqual(baseline.layout)
    expect(imported.appearance).toEqual(baseline.appearance)
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'workspace.json'), 'utf8')).sessions.map((session: { id: string }) => session.id)).toEqual(imported.sessions.map(session => session.id))
    await assertExistingWork()
    await transfer.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
    await expect(transfer).toHaveCount(0)

    await page.getByRole('button', { name: 'Nhập / Xuất cấu hình', exact: true }).click()
    await saveDialogFile(null)
    await transfer.getByRole('button', { name: 'Xuất cấu hình', exact: true }).click()
    await expect(transfer).toHaveAttribute('aria-busy', 'false')
    expect(existsSync(exportFile)).toBe(false)
    expect(await getState()).toEqual(imported)
    await expect(transfer.getByRole('status')).toHaveCount(0)
    await saveDialogFile(exportFile)
    await transfer.getByRole('button', { name: 'Xuất cấu hình', exact: true }).click()
    await expect(transfer.getByRole('status')).toContainText('Đã lưu file cấu hình.')
    const serialized = readFileSync(exportFile, 'utf8')
    const exported = JSON.parse(serialized) as WorkspaceTransfer
    expect(Object.keys(exported).sort()).toEqual(['groups', 'sessions', 'templates', 'version'])
    expect(exported.groups).toHaveLength(imported.groups.length)
    expect(exported.sessions).toHaveLength(imported.sessions.length)
    expect(exported.sessions.find(session => session.name === 'Terminal từ cấu hình')?.command).toBe(command)
    for (const session of exported.sessions) {
      expect(Object.keys(session).sort()).toEqual(['command', 'cwd', 'groupId', 'kind', 'name'])
    }
    expect(Object.keys(exported.templates[0]).sort()).toEqual(['command', 'cwd', 'kind', 'name'])
    expect(serialized).not.toContain(runtimeSecret)
    expect(serialized).not.toContain('123456789')
    expect(serialized).not.toContain('987654321')
    await assertExistingWork()

    // Exported files are directly importable; each preview can be consumed only once.
    await chooseDialogFile(exportFile)
    const reimportPreview = await page.evaluate(() => window.harbor.chooseImport())
    expect(reimportPreview?.fileName).toBe('exported-project.json')
    expect(reimportPreview?.sessions).toEqual(exported.sessions)
    const reimported = await page.evaluate(token => window.harbor.importWorkspace(token), reimportPreview!.token)
    expect(reimported).toEqual({ groups: 3, sessions: 3, templates: 1 })
    const roundTripped = await getState()
    expect(roundTripped.groups).toHaveLength(imported.groups.length * 2)
    expect(roundTripped.sessions).toHaveLength(imported.sessions.length * 2)
    expect(roundTripped.templates).toHaveLength(2)
    expect(new Set(roundTripped.sessions.map(session => session.id)).size).toBe(roundTripped.sessions.length)
    expect(roundTripped.sessions.slice(imported.sessions.length).every(session => session.status === 'stopped' && !session.pid)).toBe(true)
    const rejectedReplay = await page.evaluate(async token => {
      try { await window.harbor.importWorkspace(token); return '' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    }, reimportPreview!.token)
    expect(rejectedReplay).toContain('Bản xem trước đã hết hiệu lực')
    expect(await getState()).toEqual(roundTripped)
    await assertExistingWork()
    await transfer.getByRole('button', { name: 'Đóng', exact: true }).click()
    await page.evaluate(id => window.harbor.writeTerminal(id, 'still-working\r'), existingId)
    await expect.poll(() => page.evaluate(async id => (await window.harbor.attachTerminal(id)).data, existingId)).toContain('EXISTING:still-working')
    expect(errors).toEqual([])
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.quit()).catch(() => {})
      await app.close().catch(() => {})
    }
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})
