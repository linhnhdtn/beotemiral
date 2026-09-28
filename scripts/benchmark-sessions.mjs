import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Uses Electron's Node runtime without opening any windows or user workspaces.
const count = Number(process.argv[2] ?? 20)
if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('Session count must be between 1 and 50.')
const dir = mkdtempSync(join(tmpdir(), 'harbor-benchmark-'))
try {
  const outfile = join(dir, 'benchmark.cjs')
  await build({
    stdin: { contents: `
      import fs from 'node:fs'
      import { setTimeout as delay } from 'node:timers/promises'
      import { SessionManager } from ${JSON.stringify(resolve('src/main/sessions.ts'))}
      import { freshWorkspace } from ${JSON.stringify(resolve('src/main/store.ts'))}
      const originalRead = fs.readdirSync
      let scans = 0
      fs.readdirSync = function(path, ...args) {
        if (path === '/proc') scans++
        return originalRead.call(this, path, ...args)
      }
      const manager = new SessionManager(freshWorkspace(), '/bin/bash')
      for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
        process.once(signal, () => { void manager.shutdown().finally(() => process.exit(code)) })
      }
      const ready = new Set()
      manager.on('output', event => { if (event.data.includes('BENCH_READY')) ready.add(event.id) })
      ;(async () => {
        try {
          const startup = performance.now()
          for (let i = 0; i < ${count}; i++) manager.create({
            name: 'Benchmark ' + i, groupId: 'default', kind: 'terminal', cwd: ${JSON.stringify(dir)},
            command: "printf 'BENCH_READY\\n'; sleep 120"
          })
          while (ready.size < ${count}) {
            if (performance.now() - startup > 15000) throw new Error('Benchmark sessions failed to start')
            await delay(25)
          }
          await delay(1000)
          const cpu = process.cpuUsage(), start = performance.now(), initialScans = scans
          await delay(6000)
          const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu)
          console.log(JSON.stringify({ sessions: ${count}, elapsedMs: Math.round(elapsedMs),
            processScans: scans - initialScans,
            mainCpuPercent: +((used.user + used.system) / (elapsedMs * 10)).toFixed(2),
            rssMiB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1) }))
        } finally { await manager.shutdown(); fs.readdirSync = originalRead }
      })().catch(error => { console.error(error); process.exitCode = 1 })
    `, resolveDir: process.cwd(), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external'
  })
  const result = spawnSync(createRequire(import.meta.url)('electron'), [outfile], {
    stdio: 'inherit', timeout: 45000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: resolve('node_modules') }
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally { rmSync(dir, { recursive: true, force: true }) }
