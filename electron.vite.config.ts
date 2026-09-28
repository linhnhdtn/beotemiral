import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { server: { port: 5187, strictPort: true }, plugins: [
    react(),
    {
      name: 'development-refresh-csp',
      apply: 'serve',
      transformIndexHtml: html => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }
  ] }
})
