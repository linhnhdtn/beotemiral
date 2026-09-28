import { useState, type FormEvent } from 'react'
import { Bot, Check, Folder, FolderOpen, LoaderCircle, Save, SquareTerminal } from 'lucide-react'
import type { AppState, LaunchSpec, Session } from '../../shared/types'

export default function SessionEditor({ state, session, close }: {
  state: AppState
  session: Session
  close: () => void
}) {
  const [form, setForm] = useState<LaunchSpec>({
    name: session.name,
    kind: session.kind,
    cwd: session.cwd,
    command: session.command,
    groupId: session.groupId
  })
  const [busy, setBusy] = useState(false)
  const [choosingFolder, setChoosingFolder] = useState(false)
  const [error, setError] = useState('')
  const currentSession = state.sessions.find(item => item.id === session.id)
  const running = currentSession?.status === 'running' || currentSession?.status === 'starting'
  const disabled = busy || choosingFolder
  const patch = (value: Partial<LaunchSpec>) => setForm(current => ({ ...current, ...value }))
  const reportError = (error: unknown) => setError(
    (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  )

  async function chooseDirectory() {
    setChoosingFolder(true)
    setError('')
    try {
      const path = await window.harbor.chooseDirectory()
      if (path) patch({ cwd: path })
    } catch (error) {
      reportError(error)
    } finally {
      setChoosingFolder(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    setError('')
    if (!currentSession) { setError('Phiên này đã bị xóa.'); return }
    if (!form.name.trim()) { setError('Nhập tên phiên.'); return }
    if (!form.cwd.trim()) { setError('Nhập thư mục làm việc.'); return }
    if (!state.groups.some(group => group.id === form.groupId)) { setError('Chọn một nhóm đang tồn tại.'); return }
    setBusy(true)
    try {
      await window.harbor.updateSession(session.id, { ...form, name: form.name.trim() })
      close()
    } catch (error) {
      reportError(error)
      setBusy(false)
    }
  }

  return <form className="form" onSubmit={event => void submit(event)} aria-busy={disabled}>
    <div className="kind-options" role="group" aria-label="Loại phiên">
      <button type="button" disabled={disabled} aria-pressed={form.kind === 'terminal'} className={form.kind === 'terminal' ? 'active' : ''} onClick={() => patch({ kind: 'terminal' })}>
        <SquareTerminal size={22}/><span><strong>Terminal</strong><small>Shell & tác vụ thông thường</small></span>{form.kind === 'terminal' && <Check size={15}/>}
      </button>
      <button type="button" disabled={disabled} aria-pressed={form.kind === 'agent'} className={form.kind === 'agent' ? 'active' : ''} onClick={() => patch({ kind: 'agent' })}>
        <Bot size={22}/><span><strong>AI agent</strong><small>Agent CLI của bạn</small></span>{form.kind === 'agent' && <Check size={15}/>}
      </button>
    </div>
    <div className="form-columns">
      <label>Tên phiên<input autoFocus required maxLength={80} disabled={disabled} value={form.name} onChange={event => patch({ name: event.target.value })}/></label>
      <label>Nhóm<select aria-label="Nhóm" required disabled={disabled} value={form.groupId} onChange={event => patch({ groupId: event.target.value })}>
        {!state.groups.some(group => group.id === form.groupId) && <option value={form.groupId}>Chọn nhóm…</option>}
        {state.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
    </div>
    <label>Thư mục làm việc<div className="input-with-action">
      <Folder size={16}/><input aria-label="Thư mục làm việc" required disabled={disabled} value={form.cwd} onChange={event => patch({ cwd: event.target.value })}/>
      <button type="button" className="icon-button" title="Chọn thư mục" aria-label="Chọn thư mục" disabled={disabled} onClick={() => void chooseDirectory()}>{choosingFolder ? <LoaderCircle className="spin" size={17}/> : <FolderOpen size={17}/>}</button>
    </div></label>
    <label>Lệnh khởi chạy <span className="optional">không bắt buộc</span>
      <div className="command-input"><span>❯</span><input aria-label="Lệnh khởi chạy" disabled={disabled} value={form.command} placeholder={form.kind === 'agent' ? 'Nhập lệnh agent đã cài trên máy' : 'Ví dụ: npm run dev'} onChange={event => patch({ command: event.target.value })}/></div>
      <small>Để trống để mở shell tương tác. Lệnh kết thúc thì phiên kết thúc.</small>
      {running && <small>Lệnh và thư mục mới áp dụng khi bạn chạy lại phiên. Tác vụ hiện tại vẫn tiếp tục chạy.</small>}
    </label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-footer">
      <span><i className="connection-dot"/>Lưu cấu hình phiên</span>
      <button type="button" className="button secondary" disabled={disabled} onClick={close}>Hủy</button>
      <button type="submit" className="button primary" disabled={disabled || !currentSession}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}Lưu thay đổi</button>
    </div>
  </form>
}
