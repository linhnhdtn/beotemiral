import { useState } from 'react'
import { Bot, CheckCircle2, Download, FileJson, Folder, LoaderCircle, SquareTerminal, Upload } from 'lucide-react'
import type { ImportPreview, ImportResult, LaunchSpec } from '../../shared/types'
import './workspace-transfer.css'

function LaunchPreview({ item }: { item: Pick<LaunchSpec, 'name' | 'kind' | 'cwd' | 'command'> }) {
  return <li className="transfer-launch">
    <div className="transfer-launch-name">
      {item.kind === 'agent' ? <Bot size={15}/> : <SquareTerminal size={15}/>}
      <strong>{item.name}</strong><span>{item.kind === 'agent' ? 'AI agent' : 'Terminal'}</span>
    </div>
    <div className="transfer-path"><Folder size={12}/><code>{item.cwd}</code></div>
    {item.command
      ? <div className="transfer-command"><span>Lệnh khởi chạy</span><pre>{item.command}</pre></div>
      : <p className="transfer-shell">Shell tương tác · không có lệnh khởi chạy</p>}
  </li>
}

export default function WorkspaceTransfer({ close }: { close: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'choose' | 'import' | 'export' | null>(null)
  const [error, setError] = useState('')
  const [exported, setExported] = useState(false)
  const reportError = (error: unknown) => setError(
    (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  )

  async function chooseFile() {
    if (busy) return
    setBusy('choose')
    setError('')
    setPreview(null)
    try {
      setPreview(await window.harbor.chooseImport())
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  async function importFile() {
    if (busy || !preview) return
    setBusy('import')
    setError('')
    try {
      setResult(await window.harbor.importWorkspace(preview.token))
      setPreview(null)
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  async function exportFile() {
    if (busy) return
    setBusy('export')
    setError('')
    setExported(false)
    try {
      setExported(await window.harbor.exportWorkspace())
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  const sessionsByGroup = new Map<string, LaunchSpec[]>()
  for (const session of preview?.sessions || []) {
    const sessions = sessionsByGroup.get(session.groupId)
    if (sessions) sessions.push(session)
    else sessionsByGroup.set(session.groupId, [session])
  }
  const hasImportItems = preview && preview.groups.length + preview.sessions.length + preview.templates.length > 0

  return <div className="form workspace-transfer" aria-busy={busy !== null}>
    <div className="transfer-body">
    {result ? <section className="transfer-complete" role="status">
      <CheckCircle2 size={32}/>
      <h3>Đã nhập cấu hình</h3>
      <p>Đã thêm {result.groups} nhóm, {result.sessions} phiên và {result.templates} mẫu lệnh.</p>
      <p>Các phiên vừa nhập đang dừng. Chọn phiên trong cây rồi bấm chạy khi bạn sẵn sàng.</p>
    </section> : <>
      <section className="transfer-section">
        <div className="transfer-section-heading"><Upload size={18}/><h3>Nhập cấu hình</h3></div>
        <p>Thêm nhóm, terminal, AI agent và mẫu lệnh từ file JSON đã xuất hoặc workspace.json.</p>
        <p>Nhóm và tác vụ hiện tại được giữ nguyên. Các phiên nhập vào chỉ chạy khi bạn chủ động khởi chạy.</p>
        <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void chooseFile()}>
          {busy === 'choose' ? <LoaderCircle className="spin" size={15}/> : <FileJson size={15}/>}
          {preview ? 'Chọn file JSON khác' : 'Chọn file JSON'}
        </button>
      </section>
      {preview && <section className="transfer-preview" aria-label="Xem trước cấu hình">
        <div className="transfer-file"><FileJson size={17}/><strong>{preview.fileName}</strong></div>
        <p className="transfer-counts">{preview.groups.length} nhóm · {preview.sessions.length} phiên · {preview.templates.length} mẫu lệnh</p>
        <div className="transfer-preview-list">
          {preview.groups.map(group => {
            const sessions = sessionsByGroup.get(group.id) || []
            return <details className="transfer-group" key={group.id} open>
              <summary><Folder size={15}/><strong>{group.name}</strong><span>{sessions.length} phiên</span></summary>
              {sessions.length > 0
                ? <ul>{sessions.map((session, index) => <LaunchPreview key={index} item={session}/>)}</ul>
                : <p className="transfer-empty">Nhóm trống</p>}
            </details>
          })}
          {preview.templates.length > 0 && <details className="transfer-group" open>
            <summary><FileJson size={15}/><strong>Mẫu lệnh</strong><span>{preview.templates.length} mẫu</span></summary>
            <ul>{preview.templates.map((template, index) => <LaunchPreview key={index} item={template}/>)}</ul>
          </details>}
          {!hasImportItems && <p className="transfer-empty">File này chưa có nhóm, phiên hoặc mẫu lệnh để nhập.</p>}
        </div>
        <p className="transfer-note">Kiểm tra thư mục và lệnh ở trên trước khi nhập. Lệnh được lưu lại và chưa chạy.</p>
      </section>}
      <section className="transfer-section transfer-export">
        <div className="transfer-section-heading"><Download size={18}/><h3>Xuất cấu hình</h3></div>
        <p>Lưu nhóm, cấu hình phiên và mẫu lệnh thành file JSON để nhập lại hoặc dùng trên máy khác.</p>
        <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void exportFile()}>
          {busy === 'export' ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>}Xuất cấu hình
        </button>
        {exported && <p className="transfer-exported" role="status"><CheckCircle2 size={15}/>Đã lưu file cấu hình.</p>}
      </section>
    </>}
    {error && <div className="form-error" role="alert">{error}</div>}
    </div>
    <div className="form-footer">
      {preview && <span>Thêm cấu hình vào không gian hiện tại</span>}
      <button type="button" className="button secondary" disabled={busy !== null} onClick={close}>{result ? 'Hoàn tất' : 'Đóng'}</button>
      {!result && preview && <button type="button" className="button primary" disabled={busy !== null || !hasImportItems} onClick={() => void importFile()}>
        {busy === 'import' ? <LoaderCircle className="spin" size={15}/> : <Upload size={15}/>}Nhập cấu hình
      </button>}
    </div>
  </div>
}
