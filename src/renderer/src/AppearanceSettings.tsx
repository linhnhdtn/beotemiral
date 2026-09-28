import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings2, Undo2 } from 'lucide-react'
import { DEFAULT_BACKGROUND_TRANSPARENCY } from '../../shared/types'

export default function AppearanceSettings({ value, preview, reportError }: {
  value: number
  preview: (value: number | null) => void
  reportError: (message: string) => void
}) {
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revision = useRef(0)
  const [saving, setSaving] = useState(false)
  const save = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const backgroundTransparency = pending.current
    if (backgroundTransparency === null) return
    pending.current = null
    const request = revision.current
    setSaving(true)
    void window.harbor.updateAppearance({ backgroundTransparency }).catch((error: unknown) => {
      reportError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (request === revision.current) { preview(null); setSaving(false) }
    })
  }, [preview, reportError])

  useEffect(() => {
    window.addEventListener('beforeunload', save)
    return () => {
      window.removeEventListener('beforeunload', save)
      if (timer.current) clearTimeout(timer.current)
      if (pending.current !== null) void window.harbor.updateAppearance({ backgroundTransparency: pending.current }).catch(() => {})
    }
  }, [save])

  function change(next: number) {
    revision.current += 1
    pending.current = next
    preview(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(save, 600)
  }

  return <details className="appearance-settings" onToggle={event => { if (!event.currentTarget.open) save() }}>
    <summary className="button secondary" title="Appearance · Background transparency" aria-label="Appearance"><Settings2 size={15}/><span>Appearance</span></summary>
    <section className="appearance-popover" aria-label="Appearance settings">
      <div className="appearance-heading"><strong>Appearance</strong><span>{value}%</span></div>
      <label htmlFor="background-transparency">Background transparency</label>
      <input id="background-transparency" type="range" min="0" max="100" step="1" value={value}
        aria-valuetext={`${value}% transparent`} onChange={event => change(Number(event.target.value))}
        onPointerUp={save} onKeyUp={save} onBlur={save}/>
      <div className="appearance-range-labels"><span>0% · Solid</span><span>100% · Transparent</span></div>
      <p>Only the background becomes transparent. Text and terminal content stay sharp.</p>
      <div className="appearance-footer"><button className="text-button" onClick={() => { change(DEFAULT_BACKGROUND_TRANSPARENCY); save() }}><Undo2 size={13}/>Default {DEFAULT_BACKGROUND_TRANSPARENCY}%</button><span role="status">{saving ? 'Saving…' : 'Saved automatically'}</span></div>
      <small>Applies to the main window and detached windows.</small>
    </section>
  </details>
}
