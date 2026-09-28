import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Check, ClipboardPaste, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import type { Session, TerminalOutput } from '../../shared/types'
import '@xterm/xterm/css/xterm.css'

export default function TerminalView({ session, reportError, backgroundTransparency, renderHeader }: { renderHeader: (clipboard: ReactNode) => ReactNode; session: Session; reportError: (message: string) => void; backgroundTransparency: number }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [context, setContext] = useState<{ x: number; y: number } | null>(null)
  const reportRef = useRef(reportError)
  reportRef.current = reportError
  const background = `rgba(8, 8, 8, ${(100 - backgroundTransparency) / 100})`

  useEffect(() => {
    if (terminal.current) terminal.current.options.disableStdin = session.status !== 'running' && session.status !== 'starting'
  }, [session.status])

  async function copy() {
    const selection = terminal.current?.getSelection()
    if (!selection) return
    try { await window.harbor.writeClipboard(selection); setCopied(true); setTimeout(() => setCopied(false), 1200) }
    catch (e) { reportRef.current(String(e)) }
    setContext(null)
  }
  async function paste() {
    try { const value = await window.harbor.readClipboard(); terminal.current?.paste(value); terminal.current?.focus() }
    catch (e) { reportRef.current(String(e)) }
    setContext(null)
  }

  useEffect(() => {
    const container = host.current
    if (!container) return
    setLoading(true); setError('')
    let cancelled = false, ready = false, leaseId: string | null = null, lastSeq = -1
    let buffered: TerminalOutput[] = []
    let frame = 0
    const term = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
      fontSize: 15, lineHeight: 1.35, scrollback: 5000, allowProposedApi: false, allowTransparency: true,
      disableStdin: session.status !== 'running' && session.status !== 'starting',
      // The host paints the full area, including space left over between character cells.
      theme: { background: '#00000000', foreground: '#e5e5e5', cursor: '#8ce8c7', selectionBackground: '#43665e',
        black: '#202629', red: '#f28087', green: '#88d4a3', yellow: '#e4c98b', blue: '#8ab9f1', magenta: '#be9de9', cyan: '#7bcfc7', white: '#d5dce0',
        brightBlack: '#a2b4c3', brightRed: '#ff9aa1', brightGreen: '#aff1c3', brightYellow: '#f4dfb0', brightBlue: '#b0d5ff', brightMagenta: '#dec4ff', brightCyan: '#a1f2e9', brightWhite: '#ffffff' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit); term.open(container); terminal.current = term
    const failure = (e: unknown) => { if (!cancelled) reportRef.current(e instanceof Error ? e.message : String(e)) }
    const unsubscribe = window.harbor.onOutput((output) => {
      if (output.id !== session.id || cancelled) return
      if (!ready) buffered.push(output)
      else if (output.seq > lastSeq) { lastSeq = output.seq; term.write(output.data) }
    })
    const input = term.onData((data) => { if (ready && !cancelled) void window.harbor.writeTerminal(session.id, data).catch(failure) })
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.shiftKey && ['C', 'V', 'c', 'v'].includes(event.key)) {
        event.preventDefault()
        if (event.type === 'keydown') { if (event.key.toLowerCase() === 'c') void copy(); else void paste() }
        return false
      }
      if ((event.ctrlKey && event.key === 'Tab') || (event.ctrlKey && event.shiftKey && ['t', 'p'].includes(event.key.toLowerCase()))) return false
      return true
    })
    const resize = () => {
      if (!ready || cancelled || !container.clientWidth || !container.clientHeight) return
      try { fit.fit(); void window.harbor.resizeTerminal(session.id, term.cols, term.rows).catch(failure) } catch (e) { failure(e) }
    }
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(resize) })
    observer.observe(container)
    void window.harbor.attachTerminal(session.id).then((snapshot) => {
      leaseId = snapshot.leaseId
      if (cancelled) { void window.harbor.releaseTerminal(session.id, snapshot.leaseId).catch(() => {}); return }
      term.resize(snapshot.cols, snapshot.rows)
      lastSeq = snapshot.seq
      term.write(snapshot.data, () => {
        if (cancelled) return
        for (const output of buffered.sort((a, b) => a.seq - b.seq)) {
          if (output.seq > lastSeq) { lastSeq = output.seq; term.write(output.data) }
        }
        buffered = []; ready = true; setLoading(false); resize(); term.focus()
      })
    }).catch((e: unknown) => { if (!cancelled) { setLoading(false); setError(e instanceof Error ? e.message : String(e)) } })
    return () => {
      cancelled = true; ready = false; cancelAnimationFrame(frame); observer.disconnect(); unsubscribe(); input.dispose()
      if (leaseId) void window.harbor.releaseTerminal(session.id, leaseId).catch(() => {})
      term.dispose(); if (terminal.current === term) terminal.current = null
    }
  }, [session.id, session.startedAt, attempt])

  return <>
    {renderHeader(<div className="pane-clipboard"><button className="icon-button" title="Sao chép vùng chọn · Ctrl+Shift+C" aria-label="Sao chép vùng chọn" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button><button className="icon-button" title="Dán · Ctrl+Shift+V" aria-label="Dán vào terminal" onClick={() => void paste()}><ClipboardPaste size={14}/></button></div>)}
    <div className="terminal-body" onClick={() => context && setContext(null)}>
    <div className="terminal-surface"><div className="terminal-host" style={{ background }} ref={host} onContextMenu={(e) => { e.preventDefault(); setContext({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 110) }) }}/></div>
    {loading && <div className="terminal-overlay"><LoaderCircle className="spin" size={22}/><span>Đang kết nối phiên…</span></div>}
    {error && <div className="terminal-overlay"><span>Không thể mở terminal</span><small>{error}</small><button className="button secondary" onClick={() => setAttempt(v => v + 1)}><RefreshCw size={14}/>Thử lại</button></div>}
    {context && <div className="context-menu" style={{ left: context.x, top: context.y }}><button onClick={() => void copy()}><Copy size={14}/>Sao chép vùng chọn</button><button onClick={() => void paste()}><ClipboardPaste size={14}/>Dán</button></div>}
    </div>
  </>
}
