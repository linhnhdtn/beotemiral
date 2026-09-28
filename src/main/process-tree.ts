import { readdirSync, readFileSync } from 'node:fs'

interface ProcessIdentity { pid: number; parent: number; session: number; start: string }
function processes(): ProcessIdentity[] {
  const result: ProcessIdentity[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const raw = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
      if (fields[0] === 'Z') continue
      result.push({ pid: Number(entry), parent: Number(fields[1]), session: Number(fields[3]), start: fields[19] })
    } catch { /* Process exited during enumeration. */ }
  }
  return result
}

/** Own only this PTY's Linux session and verified descendants; never signal a recycled PID. */
export class ProcessTree {
  private static tracked = new Set<ProcessTree>()
  private static timer?: NodeJS.Timeout
  private known = new Map<number, string>()
  private closing?: Promise<void>
  constructor(private root: number) {
    this.refresh()
    ProcessTree.tracked.add(this)
    if (!ProcessTree.timer) {
      ProcessTree.timer = setInterval(() => {
        // Enumerating /proc is the expensive part; share one fresh scan across all PTYs.
        const all = processes()
        for (const tree of ProcessTree.tracked) tree.refresh(all)
      }, 300)
      ProcessTree.timer.unref()
    }
  }
  private refresh(all = processes()): ProcessIdentity[] {
    const owned = new Set<number>()
    for (const p of all) if (p.session === this.root || this.known.get(p.pid) === p.start) owned.add(p.pid)
    let changed = true
    while (changed) {
      changed = false
      for (const p of all) if (owned.has(p.parent) && !owned.has(p.pid)) { owned.add(p.pid); changed = true }
    }
    const matched = all.filter(p => owned.has(p.pid))
    // Exited children no longer need tracking, even in long-lived agent sessions.
    this.known = new Map(matched.map(p => [p.pid, p.start]))
    return matched
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing
    ProcessTree.tracked.delete(this)
    if (ProcessTree.tracked.size === 0) {
      clearInterval(ProcessTree.timer)
      ProcessTree.timer = undefined
    }
    this.closing = (async () => {
      const signal = (name: NodeJS.Signals) => {
        // Capture descendants before the shell exits and reparents them.
        const owned = this.refresh()
        for (const p of owned.sort((a, b) => Number(a.pid === this.root) - Number(b.pid === this.root))) {
          try { process.kill(p.pid, name) } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e
          }
        }
      }
      signal('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 650))
      signal('SIGKILL')
    })()
    return this.closing
  }
}
