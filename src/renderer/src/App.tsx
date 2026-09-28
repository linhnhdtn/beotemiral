import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowLeft, ArrowUpRight, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Command, Folder, FolderOpen, Layers3, LayoutGrid, LoaderCircle, MoreHorizontal, PanelsTopLeft, Plus, Power, Search, Settings2, Square, SquareTerminal, TerminalSquare, Trash2, Undo2, X } from 'lucide-react'
import type { AppState, Group, LaunchSpec, LaunchTemplate, Session } from '../../shared/types'
import TerminalView from './TerminalView'
import AppearanceSettings from './AppearanceSettings'
import WorkspaceTree from './WorkspaceTree'
import SessionEditor from './SessionEditor'
import WorkspaceTransfer from './WorkspaceTransfer'
import { version as appVersion } from '../../../package.json'

const api = window.harbor
const colors = ['#71dcb7', '#93afff', '#c2a0ef', '#f0bd79', '#eb91a5', '#78cbd8']
const labels: Record<Session['status'], string> = { starting: 'Khởi động', running: 'Đang chạy', finished: 'Hoàn thành', stopped: 'Đã dừng', error: 'Có lỗi' }
const running = (s: Session) => s.status === 'running' || s.status === 'starting'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
const shortPath = (path: string, home: string) => path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
function duration(start: string, end?: string) { const m = Math.max(0, Math.floor((new Date(end || Date.now()).getTime() - new Date(start).getTime()) / 60000)); return m < 1 ? 'vừa bắt đầu' : m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút` }
function Status({ session }: { session: Session }) { return <span className={`status ${session.status}`}><i/>{session.restored ? 'Chưa chạy lại' : labels[session.status]}</span> }
function SessionIcon({ kind, size = 19 }: { kind: Session['kind']; size?: number }) { return kind === 'agent' ? <Bot size={size}/> : <SquareTerminal size={size}/> }
type Modal = { type: 'new'; template?: LaunchTemplate; groupId?: string } | { type: 'group'; group?: Group } | { type: 'session'; session: Session } | { type: 'templates' } | { type: 'search' } | { type: 'help' } | { type: 'transfer' } | null

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [appearancePreview, setAppearancePreview] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'agent'>('all')
  const [, setClock] = useState(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groupTerminals = useRef(new Map<string, { activeId: string; splitId: string | null }>())
  const detachedId = new URLSearchParams(window.location.search).get('session')
  const reportError = useCallback((value: string) => { setToast(value); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 8000) }, [])
  const act = useCallback(async (action: () => Promise<unknown>) => { try { await action() } catch (e) { reportError(message(e)) } }, [reportError])
  useEffect(() => {
    if (!api) { setLoadError('Hãy mở Task Harbor bằng ứng dụng desktop để sử dụng terminal.'); return }
    let received = false, cancelled = false
    const unsub = api.onState(next => { received = true; if (!cancelled) setState(next) })
    void api.getState().then(next => { if (!cancelled && !received) setState(next) }).catch(e => { if (!cancelled) setLoadError(message(e)) })
    const timer = setInterval(() => setClock(n => n + 1), 30000)
    return () => { cancelled = true; unsub(); clearInterval(timer); if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])
  useEffect(() => {
    if (!state || detachedId) return
    for (const id of groupTerminals.current.keys()) {
      if (!state.groups.some(group => group.id === id)) groupTerminals.current.delete(id)
    }
    if (state.layout.view !== 'terminal') return
    const active = state.sessions.find(session => session.id === state.layout.activeId)
    if (active) groupTerminals.current.set(active.groupId, { activeId: active.id, splitId: state.layout.splitId })
  }, [state, detachedId])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setModal(null); document.querySelectorAll('details.menu[open], details.appearance-settings[open]').forEach(d => d.removeAttribute('open')); return }
      if (detachedId || !state) return
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); setModal({ type: 'new' }) }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setModal({ type: 'search' }) }
      if (e.ctrlKey && e.key === 'Tab' && !modal) {
        e.preventDefault()
        const sessions = state.sessions.filter(s => !state.layout.groupId || s.groupId === state.layout.groupId)
        const current = sessions.findIndex(s => s.id === state.layout.activeId)
        const next = sessions[(current + (e.shiftKey ? -1 : 1) + sessions.length) % sessions.length]
        if (next) void act(() => api.updateLayout({ view: 'terminal', activeId: next.id, splitId: state.layout.splitId === next.id ? null : state.layout.splitId }))
      }
    }
    const outside = (e: PointerEvent) => document.querySelectorAll('details.menu[open], details.appearance-settings[open]').forEach(d => { if (!d.contains(e.target as Node)) d.removeAttribute('open') })
    window.addEventListener('keydown', handler); window.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('pointerdown', outside) }
  }, [state, modal, detachedId, act])

  if (!state) return <div className="startup"><div className="brand-mark"><PanelsTopLeft size={30}/></div><h1>Task Harbor</h1>{loadError ? <><p>{loadError}</p><button className="button secondary" onClick={() => window.location.reload()}>Thử lại</button></> : <><LoaderCircle className="spin" size={22}/><p>Đang mở không gian làm việc…</p></>}</div>
  const backgroundTransparency = appearancePreview ?? state.appearance.backgroundTransparency
  const selectedGroup = state.groups.find(g => g.id === state.layout.groupId)
  const allVisible = state.sessions.filter(s => !selectedGroup || s.groupId === selectedGroup.id)
  const visible = allVisible.filter(s => (kindFilter === 'all' || s.kind === 'agent') && `${s.name} ${s.command} ${s.cwd}`.toLowerCase().includes(search.toLowerCase()))
  const live = state.sessions.filter(running)
  const active = state.sessions.find(s => s.id === (detachedId || state.layout.activeId))
  const split = state.sessions.find(s => s.id === state.layout.splitId && s.id !== active?.id)
  const openSession = (s: Session) => {
    setModal(null)
    void act(async () => {
      if (state.groups.find(g => g.id === s.groupId)?.collapsed) await api.updateGroup(s.groupId, { collapsed: false })
      if (s.detached) await api.focusSession(s.id)
      else await api.updateLayout({ view: 'terminal', activeId: s.id, groupId: s.groupId, splitId: state.layout.splitId === s.id ? null : state.layout.splitId })
    })
  }
  const selectGroup = (id: string | null) => {
    setSearch(''); setKindFilter('all')
    // The global overview remains an explicit destination; groups resume their last terminal.
    if (id === null) { void act(() => api.updateLayout({ view: 'overview', groupId: null })); return }
    const remembered = groupTerminals.current.get(id)
    const active = state.sessions.find(session => session.groupId === id && session.id === remembered?.activeId)
      ?? state.sessions.find(session => session.groupId === id)
    const split = active && state.sessions.find(session => session.id === remembered?.splitId && session.id !== active.id)
    void act(() => api.updateLayout({ groupId: id, view: active ? 'terminal' : 'overview', activeId: active?.id ?? null, splitId: split?.id ?? null }))
  }
  const sessionMenu = (s: Session) => <Menu label={`Thao tác với ${s.name}`}>
    <button onClick={() => setModal({ type: 'session', session: s })}><Settings2 size={15}/>Chỉnh sửa phiên</button>
    <button onClick={() => void act(() => s.detached ? api.dockSession(s.id) : api.detachSession(s.id))}>{s.detached ? <Undo2 size={15}/> : <ArrowUpRight size={15}/>} {s.detached ? 'Đưa về cửa sổ chính' : 'Mở cửa sổ riêng'}</button>
    {!running(s) && <button onClick={() => void act(() => api.restartSession(s.id))}><Undo2 size={15}/>Chạy lại phiên</button>}
    {running(s) && <button onClick={() => void act(() => api.stopSession(s.id))}><Square size={14}/>Dừng phiên</button>}
    <div className="menu-divider"/><button className="danger-text" onClick={() => void act(() => api.removeSession(s.id))}><Trash2 size={15}/>Xóa phiên</button>
  </Menu>
  const terminalPane = (s: Session, secondary = false) => <section className="terminal-pane" key={s.id} aria-label={`Terminal ${s.name}`}>
    <div className="pane-header"><div className="pane-name"><SessionIcon kind={s.kind} size={16}/><strong>{s.name}</strong><Status session={s}/></div><div className="pane-actions">{!running(s) && <button className="text-button" onClick={() => void act(() => api.restartSession(s.id))}><Undo2 size={13}/>Chạy lại</button>}{secondary && <button className="icon-button" aria-label="Đóng khung chia đôi" title="Đóng khung chia đôi" onClick={() => void act(() => api.updateLayout({ splitId: null }))}><X size={16}/></button>}{sessionMenu(s)}</div></div>
    {s.detached && !detachedId ? <div className="detached-placeholder"><div className="empty-symbol"><ArrowUpRight size={28}/></div><h3>Phiên đang ở cửa sổ riêng</h3><p>Tiến trình vẫn chạy khi bạn chuyển cửa sổ.</p><div className="button-row"><button className="button primary" onClick={() => void act(() => api.focusSession(s.id))}>Đến cửa sổ</button><button className="button secondary" onClick={() => void act(() => api.dockSession(s.id))}><Undo2 size={15}/>Đưa về đây</button></div></div> : <TerminalView key={`${s.id}:${s.startedAt}`} session={s} reportError={reportError} backgroundTransparency={backgroundTransparency}/>}
    {s.pendingLaunch && running(s) && <div className="terminal-notice">Đã lưu lệnh / thư mục mới cho lần chạy tiếp theo. Phiên hiện tại vẫn tiếp tục.</div>}
    {(s.error || s.restored || (s.exitCode !== undefined && !running(s))) && <div className={`terminal-notice ${s.error ? 'error' : ''}`}>{s.error || (s.restored ? 'Cấu hình đã được khôi phục. Chọn “Chạy lại” để bắt đầu phiên mới.' : `Phiên đã kết thúc · exit code ${s.exitCode}`)}</div>}
  </section>

  return <div className={`app ${detachedId ? 'detached-app' : ''}`} style={{ '--background-alpha': (100 - backgroundTransparency) / 100 } as CSSProperties}>
    {!detachedId && <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><PanelsTopLeft size={23}/></div><div><strong>Task Harbor</strong><span>YOUR LOCAL WORKSPACE</span></div></div>
      <button className="sidebar-search" onClick={() => setModal({ type: 'search' })}><Search size={16}/><span>Tìm nhanh một phiên</span><kbd>⌃ P</kbd></button>
      <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
      <button className={`nav-item ${!selectedGroup ? 'selected' : ''}`} onClick={() => selectGroup(null)}><LayoutGrid size={18}/><span>Tất cả phiên</span><span className="nav-count">{state.sessions.length}</span></button>
      <div className="nav-label groups-label"><span>NHÓM CỦA BẠN</span><button className="icon-button" title="Tạo nhóm" aria-label="Tạo nhóm" onClick={() => setModal({ type: 'group' })}><Plus size={15}/></button></div>
      <WorkspaceTree state={state} selectedSessionId={state.layout.view === 'terminal' ? active?.id : undefined}
        onSelectGroup={group => { if (group.collapsed) void act(() => api.updateGroup(group.id, { collapsed: false })); selectGroup(group.id) }}
        onOpenSession={openSession} onEditGroup={group => setModal({ type: 'group', group })}
        onEditSession={session => setModal({ type: 'session', session })}
        onCreateSession={groupId => setModal({ type: 'new', groupId })}
        onToggleGroup={group => void act(() => api.updateGroup(group.id, { collapsed: !group.collapsed }))}
        onReorderGroups={ids => void act(() => api.reorderGroups(ids))}
        onMoveSession={(id, groupId, beforeId) => void act(() => api.moveSession(id, groupId, beforeId))}/>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setModal({ type: 'transfer' })}><FolderOpen size={17}/><span>Nhập / Xuất cấu hình</span></button><button className="nav-item" onClick={() => setModal({ type: 'templates' })}><Command size={17}/><span>Mẫu lệnh</span><span className="nav-count">{state.templates.length}</span></button><button className="nav-item" onClick={() => setModal({ type: 'help' })}><CircleHelp size={17}/><span>Phím tắt & hướng dẫn</span></button><div className="local-workspace"><div className="local-avatar"><TerminalSquare size={18}/></div><div><strong>Trên máy của bạn</strong><span><i/>{live.length} phiên đang chạy</span></div><button className="icon-button" title="Thoát hoàn toàn" aria-label="Thoát hoàn toàn" onClick={() => void act(() => api.quit())}><Power size={16}/></button></div></div>
    </aside>}
    <main className="main">
      <header className="topbar"><div className="breadcrumbs">{detachedId ? <><PanelsTopLeft size={18}/><span>Task Harbor</span><ChevronRight size={13}/><strong>{active?.name || 'Terminal'}</strong></> : <><Layers3 size={17}/><span>Workspace</span><ChevronRight size={13}/><strong>{selectedGroup?.name || 'Tổng quan'}</strong></>}</div><div className="topbar-actions"><AppearanceSettings value={backgroundTransparency} preview={setAppearancePreview} reportError={reportError}/>{detachedId ? <button className="button secondary" onClick={() => active && void act(() => api.dockSession(active.id))}><Undo2 size={15}/>Về cửa sổ chính</button> : <><span className="local-label"><i/>Local</span><button className="button primary" onClick={() => setModal({ type: 'new' })}><Plus size={17}/>Terminal mới<kbd>⌃ ⇧ T</kbd></button></>}</div></header>
      {state.warning && <div className="workspace-warning">{state.warning}</div>}
      {detachedId ? <div className="terminal-workspace detached-workspace">{active ? terminalPane(active) : <div className="empty-state"><h2>Phiên không còn tồn tại</h2><p>Bạn có thể đóng cửa sổ này.</p></div>}</div> : state.layout.view === 'terminal' && active ? <div className="terminal-workspace">
        <div className="terminal-navigation"><button className="icon-button" title="Về tổng quan" aria-label="Về tổng quan" onClick={() => void act(() => api.updateLayout({ view: 'overview' }))}><ArrowLeft size={17}/></button><div className="terminal-location"><Layers3 size={15}/><span>{state.groups.find(g => g.id === active.groupId)?.name}</span><ChevronRight size={13}/><strong>{active.name}</strong></div><button className="icon-button" aria-label="Tạo terminal mới" onClick={() => setModal({ type: 'new' })}><Plus size={17}/></button><div className="split-picker"><select aria-label="Chia đôi terminal" value={split?.id || ''} onChange={e => void act(() => api.updateLayout({ splitId: e.target.value || null }))}><option value="">Một khung</option>{state.sessions.filter(s => s.id !== active.id).map(s => <option key={s.id} value={s.id}>Chia đôi · {s.name}</option>)}</select><ChevronDown size={13}/></div></div>
        <div className={`terminal-panes ${split ? 'split' : ''}`}>{terminalPane(active)}{split && terminalPane(split, true)}</div>
      </div> : <div className="overview">
        <section className="overview-heading"><div><div className="eyebrow"><span className="tiny-square"/>MỌI THỨ TRONG TẦM MẮT</div><h1>{selectedGroup?.name || 'Không gian làm việc'}</h1><p>Terminal, tác vụ và AI agent. Cùng một nơi, luôn có tổ chức.</p></div>{selectedGroup ? <button className="button secondary group-manage" onClick={() => setModal({ type: 'group', group: selectedGroup })}><Settings2 size={15}/>Quản lý nhóm</button> : <div className="overview-emblem" aria-hidden="true"><PanelsTopLeft size={35}/><span>⌘</span><i/></div>}</section>
        <div className="stats"><div className="stat"><span className="stat-icon mint"><Activity size={18}/></span><div><span>Đang chạy</span><strong>{allVisible.filter(running).length}<small>phiên</small></strong></div><span className="stat-live"/></div><div className="stat"><span className="stat-icon purple"><Bot size={19}/></span><div><span>AI agent</span><strong>{allVisible.filter(s => s.kind === 'agent').length}<small>agent</small></strong></div></div><div className="stat"><span className="stat-icon blue"><SquareTerminal size={18}/></span><div><span>Terminal</span><strong>{allVisible.filter(s => s.kind === 'terminal').length}<small>phiên</small></strong></div></div><div className="stat"><span className="stat-icon sand"><Layers3 size={18}/></span><div><span>{selectedGroup ? 'Đã kết thúc' : 'Nhóm làm việc'}</span><strong>{selectedGroup ? allVisible.filter(s => !running(s)).length : state.groups.length}<small>{selectedGroup ? 'phiên' : 'nhóm'}</small></strong></div></div></div>
        <div className="sessions-toolbar"><div className="segmented"><button className={kindFilter === 'all' ? 'active' : ''} onClick={() => setKindFilter('all')}>Tất cả phiên<span>{allVisible.length}</span></button><button className={kindFilter === 'agent' ? 'active' : ''} onClick={() => setKindFilter('agent')}><Bot size={14}/>AI agent</button></div><label className="filter-search"><Search size={15}/><input aria-label="Lọc phiên" placeholder="Tìm tên, lệnh, thư mục…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button className="icon-button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}><X size={13}/></button>}</label></div>
        {state.sessions.length === 0 ? <div className="empty-state first-session"><div className="empty-illustration"><div className="mini-window back"><Bot size={21}/><span/></div><div className="mini-window front"><div><i/><i/><i/></div><strong>❯ <span>_</span></strong><em/><em/></div><div className="floating-plus"><Plus size={18}/></div></div><h2>Một nơi cho mọi phiên chạy</h2><p>Mở terminal đầu tiên, chạy agent yêu thích<br/>và gom công việc theo cách của bạn.</p><button className="button primary" onClick={() => setModal({ type: 'new' })}><Plus size={16}/>Tạo terminal đầu tiên</button><span className="empty-hint">Shell tương tác · Lệnh tùy chỉnh · AI agent</span></div> : visible.length === 0 ? <div className="empty-state"><div className="empty-symbol">{search ? <Search size={26}/> : <FolderOpen size={26}/>}</div><h2>{search ? 'Chưa tìm thấy phiên phù hợp' : 'Nhóm này đang trống'}</h2><p>{search ? 'Thử tìm theo tên tác vụ, lệnh hoặc đường dẫn.' : 'Tạo một terminal để bắt đầu công việc tại đây.'}</p><button className="button secondary" onClick={() => search || kindFilter !== 'all' ? (setSearch(''), setKindFilter('all')) : setModal({ type: 'new' })}>{search || kindFilter !== 'all' ? 'Bỏ bộ lọc' : 'Tạo terminal'}</button></div> : <div className="session-groups">{state.groups.filter(g => visible.some(s => s.groupId === g.id)).map(group => <section className="session-group" key={group.id}><div className="section-heading"><h2><span className="group-dot" style={{ '--group-color': group.color } as CSSProperties}/>{group.name}<span>{visible.filter(s => s.groupId === group.id).length}</span></h2><button className="text-button" onClick={() => setModal({ type: 'new', groupId: group.id })}><Plus size={13}/>Thêm phiên</button></div><div className="session-grid">{visible.filter(s => s.groupId === group.id).map(s => <article className={`session-card ${s.kind}`} key={s.id}><div className="card-top"><span className={`session-symbol ${s.kind}`}><SessionIcon kind={s.kind}/></span><Status session={s}/>{sessionMenu(s)}</div><button className="card-open" onClick={() => openSession(s)}><h3>{s.name}<ArrowUpRight size={15}/></h3><span className="session-command">{s.command || state.shell}</span></button><div className="card-path" title={s.cwd}><Folder size={13}/><span>{shortPath(s.cwd, state.home)}</span></div><div className="card-footer"><span>{s.detached ? <><ArrowUpRight size={12}/>Cửa sổ riêng</> : s.restored ? 'Cấu hình đã lưu' : <><i className={running(s) ? 'live' : ''}/>{duration(s.startedAt, s.endedAt)}</>}</span><span>{s.exitCode !== undefined && !running(s) ? `exit ${s.exitCode}` : s.pid ? `PID ${s.pid}` : s.kind === 'agent' ? 'AI AGENT' : 'TERMINAL'}</span></div>{s.error && <div className="card-error" title={s.error}>{s.error}</div>}</article>)}</div></section>)}</div>}
        <div className="overview-footer"><span><Check size={12}/>Tiến trình tiếp tục khi đóng cửa sổ</span><span>Chuyển nhanh giữa các phiên <kbd>Ctrl</kbd><kbd>Tab</kbd></span></div>
      </div>}
      <footer className="statusbar"><span><i className="connection-dot"/>Kết nối cục bộ<span className="statusbar-separator">/</span>{state.shell.split('/').pop()}</span><span>{state.sessions.length} phiên<span className="statusbar-separator">·</span>{live.length} đang chạy<span className="statusbar-separator">·</span>Task Harbor <span className="version">v{appVersion}</span></span></footer>
    </main>
    {toast && <div className="toast" role="alert"><span>{toast}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={16}/></button></div>}
    {modal && <ModalContent modal={modal} state={state} close={() => setModal(null)} setModal={setModal} openSession={openSession} act={act}/>}
  </div>
}

function Menu({ children, label }: { children: ReactNode; label: string }) { return <details className="menu"><summary className="icon-button" aria-label={label} title={label}><MoreHorizontal size={18}/></summary><div className="menu-popover" onClick={e => { if ((e.target as HTMLElement).closest('button')) (e.currentTarget.parentElement as HTMLDetailsElement).open = false }}>{children}</div></details> }
function ModalFrame({ title, subtitle, children, close, wide = false }: { title: string; subtitle: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea') || panel.current?.querySelector<HTMLElement>('button')
    first?.focus()
    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(el => el.offsetParent !== null)
      if (!elements.length) return
      if (e.shiftKey && document.activeElement === elements[0]) { e.preventDefault(); elements.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0].focus() }
    }
    window.addEventListener('keydown', trap)
    return () => { window.removeEventListener('keydown', trap); previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div className={`modal ${wide ? 'wide' : ''}`} ref={panel} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Đóng hộp thoại" onClick={close}><X size={19}/></button></div>{children}</div></div>
}
function ModalContent({ modal, state, close, setModal, openSession, act }: { modal: NonNullable<Modal>; state: AppState; close: () => void; setModal: (m: Modal) => void; openSession: (s: Session) => void; act: (action: () => Promise<unknown>) => Promise<void> }) {
  if (modal.type === 'new') return <NewSession state={state} template={modal.template} groupId={modal.groupId} close={close}/>
  if (modal.type === 'group') return <GroupForm state={state} group={modal.group} close={close}/>
  if (modal.type === 'session') return <SessionForm state={state} session={modal.session} close={close}/>
  if (modal.type === 'transfer') return <ModalFrame title="Nhập / Xuất cấu hình" subtitle="Mang nhóm và cấu hình terminal sang không gian làm việc của bạn." close={close}><WorkspaceTransfer close={close}/></ModalFrame>
  if (modal.type === 'search') return <QuickSearch state={state} close={close} openSession={openSession}/>
  if (modal.type === 'templates') return <ModalFrame title="Mẫu lệnh của bạn" subtitle="Lưu một lần, mở lại công việc quen thuộc chỉ với một chạm." close={close}><div className="template-list">{state.templates.length ? state.templates.map(t => <div className="template-row" key={t.id}><div className={`session-symbol ${t.kind}`}><SessionIcon kind={t.kind}/></div><button className="template-main" onClick={() => setModal({ type: 'new', template: t })}><strong>{t.name}</strong><code>{t.command || state.shell}</code><small>{shortPath(t.cwd, state.home)}</small></button><button className="icon-button" title={`Xóa mẫu ${t.name}`} aria-label={`Xóa mẫu ${t.name}`} onClick={() => void act(() => api.removeTemplate(t.id))}><Trash2 size={15}/></button><button className="icon-button" title={`Mở mẫu ${t.name}`} aria-label={`Mở mẫu ${t.name}`} onClick={() => setModal({ type: 'new', template: t })}><ArrowUpRight size={17}/></button></div>) : <div className="modal-empty"><Command size={29}/><h3>Chưa có mẫu lệnh</h3><p>Chọn “Lưu thành mẫu” khi tạo terminal mới.</p><button className="button primary" onClick={() => setModal({ type: 'new' })}><Plus size={15}/>Tạo terminal</button></div>}</div></ModalFrame>
  return <ModalFrame title="Làm việc liền mạch" subtitle="Những thao tác nhỏ giúp bạn tập trung vào công việc." close={close}><div className="shortcut-list">{[['Tạo terminal mới', 'Ctrl + Shift + T'], ['Tìm và chuyển nhanh đến phiên', 'Ctrl + Shift + P'], ['Chuyển sang phiên tiếp theo', 'Ctrl + Tab'], ['Chuyển sang phiên trước', 'Ctrl + Shift + Tab'], ['Sao chép vùng chọn terminal', 'Ctrl + Shift + C'], ['Dán vào terminal', 'Ctrl + Shift + V'], ['Dừng lệnh trong terminal', 'Ctrl + C']].map(([name, key]) => <div key={name}><span>{name}</span><kbd>{key}</kbd></div>)}</div><div className="help-note"><strong>Đóng cửa sổ vẫn tiếp tục chạy</strong><p>Mở lại từ khay hệ thống hoặc biểu tượng ứng dụng. Chọn nút nguồn ở thanh bên để thoát hoàn toàn.</p><strong>AI agent chạy bằng lệnh của bạn</strong><p>Chọn loại AI agent và nhập lệnh CLI đã cài trên máy. Trạng thái hiển thị theo tiến trình; cấu hình được giữ lại khi mở lại ứng dụng.</p></div></ModalFrame>
}

function NewSession({ state, template, groupId, close }: { state: AppState; template?: LaunchTemplate; groupId?: string; close: () => void }) {
  const [form, setForm] = useState<LaunchSpec>({ name: template?.name || '', kind: template?.kind || 'terminal', cwd: template?.cwd || state.home, command: template?.command || '', groupId: groupId || state.layout.groupId || state.groups[0]?.id || '' })
  const [save, setSave] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const patch = (value: Partial<LaunchSpec>) => setForm(current => ({ ...current, ...value }))
  const applyTemplate = (id: string) => { const t = state.templates.find(x => x.id === id); if (t) patch({ name: t.name, kind: t.kind, cwd: t.cwd, command: t.command }) }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const spec = { ...form, name: form.name.trim() || (form.kind === 'agent' ? 'AI agent' : 'Terminal') }
      if (save) { await api.saveTemplate({ name: spec.name, kind: spec.kind, cwd: spec.cwd, command: spec.command }); setSave(false) }
      const id = await api.createSession(spec)
      await api.updateLayout({ activeId: id, view: 'terminal', groupId: spec.groupId }); close()
    } catch (e) { setError(message(e)); setBusy(false) }
  }
  return <ModalFrame title="Bắt đầu một phiên mới" subtitle="Chọn nơi làm việc, nhập lệnh và sẵn sàng bắt đầu." close={close}><form onSubmit={e => void submit(e)} className="form">
    <div className="kind-options"><button type="button" className={form.kind === 'terminal' ? 'active' : ''} onClick={() => patch({ kind: 'terminal' })}><SquareTerminal size={22}/><span><strong>Terminal</strong><small>Shell & tác vụ thông thường</small></span>{form.kind === 'terminal' && <Check size={15}/>}</button><button type="button" className={form.kind === 'agent' ? 'active' : ''} onClick={() => patch({ kind: 'agent' })}><Bot size={22}/><span><strong>AI agent</strong><small>Agent CLI của bạn</small></span>{form.kind === 'agent' && <Check size={15}/>}</button></div>
    {state.templates.length > 0 && <label>Dùng mẫu có sẵn<select defaultValue={template?.id || ''} onChange={e => applyTemplate(e.target.value)}><option value="">Chọn một mẫu lệnh…</option>{state.templates.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>}
    <div className="form-columns"><label>Tên phiên<input autoFocus placeholder={form.kind === 'agent' ? 'Ví dụ: Agent review code' : 'Ví dụ: Frontend dev'} value={form.name} onChange={e => patch({ name: e.target.value })} maxLength={80}/></label><label>Nhóm<select aria-label="Nhóm" value={form.groupId} required onChange={e => patch({ groupId: e.target.value })}>{state.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label></div>
    <label>Thư mục làm việc<div className="input-with-action"><Folder size={16}/><input aria-label="Thư mục làm việc" required value={form.cwd} onChange={e => patch({ cwd: e.target.value })}/><button type="button" className="icon-button" title="Chọn thư mục" aria-label="Chọn thư mục" onClick={() => { void api.chooseDirectory().then(path => path && patch({ cwd: path })).catch(e => setError(message(e))) }}><FolderOpen size={17}/></button></div></label>
    <label>Lệnh khởi chạy <span className="optional">không bắt buộc</span><div className="command-input"><span>❯</span><input aria-label="Lệnh khởi chạy" placeholder={form.kind === 'agent' ? 'Nhập lệnh agent đã cài trên máy' : 'Ví dụ: npm run dev'} value={form.command} onChange={e => patch({ command: e.target.value })}/></div><small>Để trống để mở shell tương tác. Lệnh kết thúc thì phiên kết thúc.</small></label>
    <label className="checkbox-label"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)}/><span>Lưu thành mẫu để sử dụng lần sau</span></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-footer"><span><i className="connection-dot"/>Chạy cục bộ trên máy bạn</span><button type="button" className="button secondary" onClick={close} disabled={busy}>Hủy</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>}Tạo phiên</button></div>
  </form></ModalFrame>
}
function GroupForm({ state, group, close }: { state: AppState; group?: Group; close: () => void }) {
  const [name, setName] = useState(group?.name || '')
  const [color, setColor] = useState(group?.color || colors[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [targetId, setTargetId] = useState('')
  const count = state.sessions.filter(s => s.groupId === group?.id).length
  const destinations = state.groups.filter(g => g.id !== group?.id)
  const destination = destinations.find(g => g.id === targetId) || destinations[0]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (group) await api.updateGroup(group.id, { name: name.trim(), color })
      else await api.createGroup(name.trim(), color)
      close()
    } catch (e) { setError(message(e)); setBusy(false) }
  }

  async function remove() {
    if (!group) return
    setBusy(true)
    setError('')
    try { await api.removeGroup(group.id, destination?.id); close() }
    catch (e) { setError(message(e)); setBusy(false) }
  }

  return <ModalFrame title={group ? 'Quản lý nhóm' : 'Tạo nhóm làm việc'} subtitle="Gom các phiên theo dự án, mục tiêu hoặc cách bạn làm việc." close={close}>
    <form className="form" onSubmit={e => void submit(e)}>
      <label>Tên nhóm<input autoFocus required maxLength={60} placeholder="Ví dụ: Website, Nghiên cứu, AI team…" value={name} onChange={e => setName(e.target.value)}/></label>
      <label>Màu nhận diện<div className="color-options">{colors.map(c => <button type="button" key={c} className={color === c ? 'active' : ''} style={{ '--group-color': c } as CSSProperties} aria-label={`Màu ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={17}/>}</button>)}</div></label>
      {group && <>
        <small>Kéo thả nhóm trực tiếp trong cây bên trái để xem và thay đổi thứ tự.</small>
        <div className="group-delete">
          <div className="group-delete-details">
            <strong>Xóa nhóm</strong>
            <p>{count ? `${count} phiên sẽ chuyển sang nhóm nhận, giữ nguyên tiến trình và lịch sử.` : 'Nhóm đang trống và có thể xóa.'}</p>
            {count > 0 && destinations.length > 0 && <label className="group-transfer-label">Chuyển phiên sang
              <select aria-label="Nhóm nhận phiên" value={destination?.id || ''} disabled={busy} onChange={e => setTargetId(e.target.value)}>
                {destinations.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>}
            {destinations.length === 0 && <p>Ứng dụng sẽ tạo “Không gian chung” để bạn tiếp tục làm việc.</p>}
          </div>
          <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}><Trash2 size={14}/>Xóa nhóm</button>
        </div>
      </>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-footer">
        <button type="button" className="button secondary" onClick={close} disabled={busy}>Hủy</button>
        <button className="button primary" disabled={busy || !name.trim()}>{busy && <LoaderCircle className="spin" size={14}/>} {group ? 'Lưu thay đổi' : 'Tạo nhóm'}</button>
      </div>
    </form>
  </ModalFrame>
}

function SessionForm({ state, session, close }: { state: AppState; session: Session; close: () => void }) {
  return <ModalFrame title="Chỉnh sửa phiên" subtitle="Cập nhật thông tin và cấu hình khởi chạy của terminal." close={close}><SessionEditor state={state} session={session} close={close}/></ModalFrame>
}
function QuickSearch({ state, close, openSession }: { state: AppState; close: () => void; openSession: (s: Session) => void }) {
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0)
  const results = state.sessions.filter(s => `${s.name} ${s.cwd} ${s.command} ${state.groups.find(g => g.id === s.groupId)?.name}`.toLowerCase().includes(query.toLowerCase()))
  return <ModalFrame title="Đi đến một phiên" subtitle="Tìm theo tên, nhóm, lệnh hoặc thư mục làm việc." close={close}><div className="quick-search"><Search size={20}/><input autoFocus placeholder="Bạn đang tìm phiên nào?" aria-label="Tìm nhanh phiên" value={query} onChange={e => { setQuery(e.target.value); setIndex(0) }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(results.length - 1, i + 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)) } if (e.key === 'Enter' && results[index]) openSession(results[index]) }}/><kbd>ESC</kbd></div><div className="quick-results">{results.length ? results.map((s, i) => <button className={`quick-result ${i === index ? 'selected' : ''}`} key={s.id} onClick={() => openSession(s)}><SessionIcon kind={s.kind}/><span><strong>{s.name}</strong><small>{state.groups.find(g => g.id === s.groupId)?.name} · {shortPath(s.cwd, state.home)}</small></span><Status session={s}/><ArrowUpRight size={15}/></button>) : <div className="modal-empty"><Search size={26}/><p>{query ? 'Không có phiên phù hợp.' : 'Chưa có phiên nào. Tạo terminal đầu tiên để bắt đầu.'}</p></div>}</div><div className="quick-footer"><span><kbd>↑</kbd><kbd>↓</kbd> để chọn</span><span><kbd>Enter</kbd> để mở phiên</span></div></ModalFrame>
}
