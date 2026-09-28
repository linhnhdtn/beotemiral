import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ProcessTree } from './process-tree'
import type { LaunchSpec, Session, TerminalOutput, TerminalSnapshot, Workspace } from '../shared/types'

interface Runtime {
  terminal: InstanceType<typeof Terminal>
  serialize: SerializeAddon
  pty?: IPty
  tree?: ProcessTree
  stopping: boolean
  seq: number
  pending: number
  cleanup?: Promise<void>
  exited: Promise<void>
  resolveExit: () => void
}
export const isLive = (session: Session): boolean => session.status === 'starting' || session.status === 'running'

export class SessionManager extends EventEmitter {
  private runtimes = new Map<string, Runtime>()
  constructor(readonly workspace: Workspace, readonly shell: string, private readonly hasViewer: (id: string) => boolean = () => false) { super() }

  get(id: string): Session {
    const session = this.workspace.sessions.find(s => s.id === id)
    if (!session) throw new Error('Terminal session not found.')
    return session
  }
  create(spec: LaunchSpec): string {
    const session: Session = { ...spec, id: randomUUID(), startedAt: new Date().toISOString(), status: 'starting', detached: false }
    this.workspace.sessions.push(session)
    this.launch(session)
    return session.id
  }
  private launch(session: Session): void {
    const terminal = new Terminal({ cols: 100, rows: 28, scrollback: 5000, allowProposedApi: true })
    const serialize = new SerializeAddon()
    terminal.loadAddon(serialize)
    let resolveExit!: () => void
    const exited = new Promise<void>(resolve => { resolveExit = resolve })
    const runtime: Runtime = { terminal, serialize, stopping: false, seq: 0, pending: 0, exited, resolveExit }
    this.runtimes.set(session.id, runtime)
    Object.assign(session, { status: 'starting', startedAt: new Date().toISOString(), endedAt: undefined, exitCode: undefined, error: undefined, pid: undefined, restored: false, pendingLaunch: undefined })
    this.emit('changed')
    try {
      if (!isAbsolute(session.cwd) || !statSync(session.cwd).isDirectory()) throw new Error('Working directory does not exist or is invalid.')
      const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith('ELECTRON_'))) as Record<string, string>
      delete env.NODE_OPTIONS
      const pty = spawn(this.shell, session.command.trim() ? ['-lic', session.command] : ['-l'], {
        cwd: session.cwd, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'TaskHarbor' },
        name: 'xterm-256color', cols: 100, rows: 28
      })
      runtime.pty = pty
      // Background CLIs can query cursor/device information even without a visible renderer.
      terminal.onData(data => { if (!this.hasViewer(session.id) && runtime.pty && !runtime.stopping) pty.write(data) })
      runtime.tree = new ProcessTree(pty.pid)
      session.pid = pty.pid
      session.status = 'running'
      pty.onData(data => {
        if (this.runtimes.get(session.id) !== runtime) return
        runtime.pending += data.length
        if (runtime.pending > 512 * 1024) pty.pause()
        terminal.write(data, () => {
          runtime.pending -= data.length
          if (runtime.pending < 128 * 1024 && runtime.pty) pty.resume()
          const output: TerminalOutput = { id: session.id, data, seq: ++runtime.seq }
          this.emit('output', output)
        })
      })
      pty.onExit(({ exitCode, signal }) => {
        runtime.pty = undefined
        session.endedAt = new Date().toISOString()
        session.exitCode = exitCode
        session.status = runtime.stopping ? 'stopped' : exitCode === 0 && !signal ? 'finished' : 'error'
        if (signal && !runtime.stopping) session.error = `Process terminated by signal ${signal}.`
        runtime.cleanup = runtime.tree?.stop()
        runtime.cleanup?.catch(error => { session.error = `Could not stop child processes: ${String(error)}`; this.emit('changed') })
        runtime.resolveExit()
        this.emit('changed')
      })
    } catch (error) {
      session.status = 'error'
      session.error = error instanceof Error ? error.message : String(error)
      session.endedAt = new Date().toISOString()
      runtime.resolveExit()
    }
    this.emit('changed')
  }
  async snapshot(id: string): Promise<TerminalSnapshot> {
    this.get(id)
    const r = this.runtimes.get(id)
    if (!r) return { data: '', seq: 0, cols: 100, rows: 28 }
    return new Promise(resolve => r.terminal.write('', () => resolve({
      data: r.serialize.serialize(), seq: r.seq, cols: r.terminal.cols, rows: r.terminal.rows
    })))
  }
  write(id: string, data: string): void {
    this.get(id)
    const r = this.runtimes.get(id)
    if (r?.pty && !r.stopping) r.pty.write(data)
  }
  resize(id: string, cols: number, rows: number): void {
    this.get(id)
    const r = this.runtimes.get(id)
    if (!r) return
    r.terminal.resize(cols, rows)
    r.pty?.resize(cols, rows)
  }
  async stop(id: string): Promise<void> {
    const session = this.get(id)
    const r = this.runtimes.get(id)
    if (!r || !isLive(session)) { await r?.cleanup; return }
    r.stopping = true
    await r.tree?.stop()
    await r.exited
  }
  async restart(id: string): Promise<void> {
    const session = this.get(id)
    if (isLive(session)) throw new Error('Stop the session before restarting it.')
    const r = this.runtimes.get(id)
    await r?.cleanup
    if (r) await new Promise<void>(resolve => r.terminal.write('', resolve))
    r?.terminal.dispose()
    this.launch(session)
  }
  async remove(id: string): Promise<void> {
    await this.stop(id)
    this.runtimes.get(id)?.terminal.dispose()
    this.runtimes.delete(id)
    this.workspace.sessions = this.workspace.sessions.filter(s => s.id !== id)
    if (this.workspace.layout.activeId === id) this.workspace.layout.activeId = null
    if (this.workspace.layout.splitId === id) this.workspace.layout.splitId = null
    this.emit('changed')
  }
  async shutdown(): Promise<void> { await Promise.all(this.workspace.sessions.map(s => this.stop(s.id))) }
}
