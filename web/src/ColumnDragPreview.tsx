import { useLayoutEffect, useRef } from 'react'

// Capture only the currently rendered column, including its scroll position.
// The inert clone has no sortable registrations, event handlers or focus targets.
export function captureColumn(element: HTMLElement, zoom: number) {
  const clone = element.cloneNode(true) as HTMLElement
  const rect = element.getBoundingClientRect()
  clone.style.cssText = `width:${rect.width / zoom}px;height:${rect.height / zoom}px;max-height:none;transform:none;opacity:1;pointer-events:none;`
  clone.classList.add('column-drag-preview')
  clone.setAttribute('inert', '')
  clone.setAttribute('aria-hidden', 'true')
  for (const item of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
    item.removeAttribute('id')
    item.removeAttribute('aria-describedby')
    item.removeAttribute('aria-labelledby')
    if (item.matches('button,input,textarea,select,a,[tabindex]'))
      item.setAttribute('tabindex', '-1')
  }
  const offsets = [...element.querySelectorAll<HTMLElement>('*')].map((item) => ({
    x: item.scrollLeft,
    y: item.scrollTop,
  }))
  return { clone, offsets }
}
export default function ColumnDragPreview({
  snapshot,
  zoom,
}: {
  snapshot: ReturnType<typeof captureColumn>
  zoom: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current!.replaceChildren(snapshot.clone)
    snapshot.clone.querySelectorAll<HTMLElement>('*').forEach((item, i) => {
      item.scrollLeft = snapshot.offsets[i].x
      item.scrollTop = snapshot.offsets[i].y
    })
    return () => {
      snapshot.clone.remove()
    }
  }, [snapshot])
  return <div ref={ref} style={{ zoom }} aria-hidden />
}
