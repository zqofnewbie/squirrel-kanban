import { useDndContext, useDndMonitor } from '@dnd-kit/core'
import { useEffect, useRef, useState } from 'react'

// Scroll the column under the pointer, even when the source row is virtualized
// or moves to another column. Keep one RAF loop rather than competing timers.
export default function BoardDragScroll() {
  const { measureDroppableContainers } = useDndContext()
  const [running, setRunning] = useState(false)
  const cardDrag = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useDndMonitor({
    onDragStart({ activatorEvent, active }) {
      cardDrag.current = active.data.current?.type === 'card'
      if ('clientX' in activatorEvent && 'clientY' in activatorEvent) {
        pointer.current = { x: Number(activatorEvent.clientX), y: Number(activatorEvent.clientY) }
        setRunning(true)
      }
    },
    onDragEnd() { pointer.current = null; setRunning(false) },
    onDragCancel() { pointer.current = null; setRunning(false) },
  })
  useEffect(() => {
    if (!running) return
    let frame = 0, previous = 0
    const move = (event: PointerEvent) => { if (pointer.current) pointer.current = { x: event.clientX, y: event.clientY } }
    const speed = (position: number, start: number, end: number) => {
      const edge = Math.min(64, (end - start) * .18)
      if (edge <= 0) return 0
      if (position < start + edge) return -Math.min(1, (start + edge - position) / edge) * 700
      if (position > end - edge) return Math.min(1, (position - end + edge) / edge) * 700
      return 0
    }
    const tick = (now: number) => {
      const dt = Math.min(32, now - (previous || now)) / 1000
      previous = now
      const point = pointer.current
      if (point) {
        let changed = false
        for (const column of cardDrag.current ? document.querySelectorAll<HTMLElement>('.kanban-column') : []) {
          const rect = column.getBoundingClientRect()
          if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue
          const area = column.querySelector<HTMLElement>('.column-cards')
          if (!area) continue
          const bounds = area.getBoundingClientRect(), before = area.scrollTop
          area.scrollTop += speed(point.y, Math.max(0, bounds.top), Math.min(innerHeight, bounds.bottom)) * dt
          changed ||= area.scrollTop !== before
          break
        }
        const canvas = document.querySelector<HTMLElement>('.board-viewport')
        if (canvas) {
          const rect = canvas.getBoundingClientRect(), before = canvas.scrollLeft
          if (point.y >= rect.top && point.y <= rect.bottom && point.x >= rect.left && point.x <= rect.right) {
            canvas.scrollLeft += speed(point.x, rect.left, rect.right) * dt
            changed ||= canvas.scrollLeft !== before
          }
        }
        if (changed) measureDroppableContainers([])
      }
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', move, true)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move, true) }
  }, [running, measureDroppableContainers])
  return null
}
