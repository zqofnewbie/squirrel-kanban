import { useEffect, useState } from 'react'

export const EXIT_RETENTION_MS = 200

// CSS exits take 180ms; retain a frame of headroom before unmounting.
// Keep closing layers alive long enough for their exit animation.
export function usePresence(open: boolean) {
  const [retained, setRetained] = useState(open)
  useEffect(() => {
    if (open) {
      setRetained(true)
      return
    }
    if (!retained) return
    const timer = window.setTimeout(() => setRetained(false), EXIT_RETENTION_MS)
    return () => window.clearTimeout(timer)
  }, [open, retained])
  return { mounted: open || retained, phase: open ? 'enter' : 'exit' }
}
