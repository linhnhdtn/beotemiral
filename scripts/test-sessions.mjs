import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// node-pty is rebuilt for Electron by postinstall, so run its integration tests
// with Electron's Node runtime rather than the host Node ABI.
const require = createRequire(import.meta.url)
const electron = require('electron')
const dir = mkdtempSync(join(tmpdir(), 'task-harbor-tests-'))
try {
  const outfile = join(dir, 'sessions.cjs')
  await build({
    entryPoints: [resolve('tests/sessions.integration.ts')], outfile,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: 'inline'
  })
  const result = spawnSync(electron, ['--test', outfile], {
    stdio: 'inherit', env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: resolve('node_modules')
    }, timeout: 120_000
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
