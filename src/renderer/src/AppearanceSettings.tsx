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
    <summary className="button secondary" title="Giao diện · Độ trong suốt nền" aria-label="Giao diện"><Settings2 size={15}/><span>Giao diện</span></summary>
    <section className="appearance-popover" aria-label="Cài đặt giao diện">
      <div className="appearance-heading"><strong>Giao diện</strong><span>{value}%</span></div>
      <label htmlFor="background-transparency">Độ trong suốt nền</label>
      <input id="background-transparency" type="range" min="0" max="100" step="1" value={value}
        aria-valuetext={`${value}% trong suốt`} onChange={event => change(Number(event.target.value))}
        onPointerUp={save} onKeyUp={save} onBlur={save}/>
      <div className="appearance-range-labels"><span>0% · Nền đặc</span><span>100% · Trong suốt</span></div>
      <p>Chỉ làm trong suốt nền. Chữ và nội dung terminal giữ nguyên độ rõ.</p>
      <div className="appearance-footer"><button className="text-button" onClick={() => { change(DEFAULT_BACKGROUND_TRANSPARENCY); save() }}><Undo2 size={13}/>Mặc định {DEFAULT_BACKGROUND_TRANSPARENCY}%</button><span role="status">{saving ? 'Đang lưu…' : 'Tự động lưu'}</span></div>
      <small>Áp dụng cho cửa sổ chính và cửa sổ riêng.</small>
    </section>
  </details>
}
