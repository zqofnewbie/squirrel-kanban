import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { toBlob } from 'html-to-image'
import BoardExport from './BoardExport'
import type { BoardDetail } from './types'

export async function captureCanvas(_source: HTMLElement, board: BoardDetail) {
  await document.fonts.ready
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('inert', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(createElement(BoardExport, { board })))
    const content = host.firstElementChild as HTMLElement
    const { width, height } = content.getBoundingClientRect()
    // Keep the entire board within portable canvas limits instead of silently
    // cropping very tall lists or exhausting memory at Retina resolution.
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1, 16000 / width, 16000 / height, Math.sqrt(32000000 / (width * height)))
    const blob = await toBlob(content, { width, height, pixelRatio })
    if (!blob) throw new Error('Empty screenshot')
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url
    link.download = `${board.name.replace(/[\\/:*?"<>|]/g, '_') || 'kanban'}-${new Date().toISOString().slice(0, 10)}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } finally { root.unmount(); host.remove() }
}
