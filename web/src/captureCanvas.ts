import { toBlob } from 'html-to-image'
import { boardBackground } from './backgrounds'
import type { BoardDetail } from './types'

export async function captureCanvas(source: HTMLElement, board: BoardDetail) {
  await document.fonts.ready
  const rect = source.getBoundingClientRect()
  const copy = source.cloneNode(true) as HTMLElement
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  // Freeze computed styles so the off-screen copy retains theme, hover-free
  // appearance and layout without moving the user's canvas or scrollbars.
  originals.forEach((original, index) => {
    const clone = copies[index], style = getComputedStyle(original)
    for (const property of style) clone.style.setProperty(property, style.getPropertyValue(property))
    clone.style.animation = 'none'
    clone.style.transition = 'none'
  })
  originals.forEach((original, index) => {
    if (!original.scrollTop && !original.scrollLeft) return
    const clone = copies[index], wrapper = document.createElement('div')
    wrapper.style.transform = `translate(${-original.scrollLeft}px, ${-original.scrollTop}px)`
    while (clone.firstChild) wrapper.appendChild(clone.firstChild)
    clone.appendChild(wrapper)
    clone.style.overflow = 'hidden'
  })
  copy.querySelectorAll('.canvas-tools-group, .card-edit, .card-pin:not(.is-pinned)').forEach(node => node.remove())
  Object.assign(copy.style, boardBackground(board.background, board.id), {
    position: 'relative', left: '0', top: '0', width: `${rect.width}px`, height: `${rect.height}px`,
    minHeight: '0', flex: 'none', margin: '0', overflow: 'hidden', backgroundColor: getComputedStyle(source).getPropertyValue('--canvas'),
  })
  // Explicit background colours take precedence over the theme fallback.
  Object.assign(copy.style, boardBackground(board.background, board.id))
  const shade = source.closest('.board-main')?.querySelector('.board-background-shade')
  if (shade) {
    const tint = document.createElement('div'), style = getComputedStyle(shade)
    tint.style.cssText = 'position:absolute;inset:0;pointer-events:none'
    tint.style.background = style.background
    tint.style.opacity = style.opacity
    copy.prepend(tint)
  }
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
  host.appendChild(copy)
  document.body.appendChild(host)
  try {
    const blob = await toBlob(copy, { width: rect.width, height: rect.height, pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      style: { position: 'relative', left: '0', top: '0' } })
    if (!blob) throw new Error('Empty screenshot')
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url
    link.download = `${board.name.replace(/[\\/:*?"<>|]/g, '_') || 'kanban'}-${new Date().toISOString().slice(0, 10)}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } finally { host.remove() }
}
