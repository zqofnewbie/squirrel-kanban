import { useEffect, useState } from 'react'

// Keep closing layers alive long enough for their exit animation.
export function usePresence(open: boolean) {
  const [retained, setRetained] = useState(open)
  useEffect(() => {
    if (open) {
      setRetained(true)
      return
    }
    const timer = window.setTimeout(() => setRetained(false), 180)
    return () => window.clearTimeout(timer)
  }, [open])
  return { mounted: open || retained, phase: open ? 'enter' : 'exit' }
}
