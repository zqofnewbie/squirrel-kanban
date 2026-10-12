import { useEffect, useRef, useState } from 'react'

// Fullscreen the document so portals (dialogs, menus, notices and drag previews)
// remain descendants of the fullscreen element. CSS hides only board chrome.
export function useCanvasFullscreen() {
  const [active, setActive] = useState(false)
  const state = useRef({ active: false, mounted: false, pending: false, native: false })
  function update(value: boolean) {
    state.current.active = value
    document.documentElement.classList.toggle('canvas-fullscreen', value)
    if (state.current.mounted) setActive(value)
  }
  async function exit() {
    update(false)
    if (state.current.native && document.fullscreenElement === document.documentElement) {
      try { await document.exitFullscreen() } catch { if (state.current.mounted && document.fullscreenElement) update(true) }
    }
  }
  async function toggle() {
    const current = state.current
    if (current.active) { await exit(); return }
    if (current.pending) return
    update(true)
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen || document.fullscreenElement) return
    current.pending = true
    try {
      await document.documentElement.requestFullscreen()
      current.native = document.fullscreenElement === document.documentElement
      // Navigation or a second click can cancel while the browser is entering.
      if ((!current.mounted || !current.active) && current.native) await document.exitFullscreen()
    } catch {
      // Unsupported/denied native fullscreen keeps the in-page canvas mode.
    } finally { current.pending = false }
  }
  useEffect(() => {
    const current = state.current
    current.mounted = true
    const changed = () => {
      if (document.fullscreenElement === document.documentElement && current.pending) current.native = true
      if (current.native && document.fullscreenElement !== document.documentElement) { current.native = false; update(false) }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      current.mounted = false
      current.active = false
      document.documentElement.classList.remove('canvas-fullscreen')
      document.removeEventListener('fullscreenchange', changed)
      if (current.native && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  return { active, toggle, exit }
}
