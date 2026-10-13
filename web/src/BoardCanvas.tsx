import { focusElement } from './focus'
import { createViewportAnchor } from './canvasViewport'
import { useCanvasFullscreen } from './useCanvasFullscreen'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { BoardScale } from './BoardZoom'
import Icon from './Icon'
import type { BoardDetail } from './types'
import { cx } from './ui'
import { usePresence } from './usePresence'

const hasCanvasOverlay = () => [...document.querySelectorAll('[role="dialog"], [role="menu"]')]
  .some(element => !element.closest('[aria-hidden="true"], [inert]'))

const PAD = 64
const clamp = (value: number) => Math.max(25, Math.min(150, Math.round(value / 5) * 5))
const read = (key: string, fallback: number) => { try { return Number(localStorage.getItem(key)) || fallback } catch { return fallback } }
const save = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch {} }

export default function BoardCanvas({ board, children }: { board: BoardDetail; children: (scale: number, height: number) => ReactNode }) {
  useLanguage()
  const fullscreen = useCanvasFullscreen()
  const fullscreenRef = useRef(fullscreen)
  fullscreenRef.current = fullscreen
  const key = `squirrel.zoom.${board.id}`
  const viewport = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const minimapToggle = useRef<HTMLButtonElement>(null)
  const [zoom, setZoom] = useState(() => clamp(read(key, 100)))
  const zoomRef = useRef(zoom)
  const [height, setHeight] = useState(500)
  const [pan, setPan] = useState(false)
  const [spacePan, setSpacePan] = useState(false)
  const actions = useRef({ reset: () => {}, fit: () => {} })
  const [minimap, setMinimap] = useState(() => read('squirrel.minimap', 0) === 1)
  const gesture = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const changeRef = useRef<(value: number, x?: number, y?: number) => void>(() => {})
  const wheelDelta = useRef(0)

  function change(value: number, x?: number, y?: number) {
    const element = viewport.current, next = clamp(value), previous = zoomRef.current
    if (!element || next === previous) return
    const px = x ?? element.clientWidth / 2, py = y ?? element.clientHeight / 2
    const wx = (element.scrollLeft + px) / (previous / 100), wy = (element.scrollTop + py) / (previous / 100)
    zoomRef.current = next; setZoom(next); save(key, String(next))
    requestAnimationFrame(() => { element.scrollLeft = wx * next / 100 - px; element.scrollTop = wy * next / 100 - py })
  }
  changeRef.current = change
  useLayoutEffect(() => {
    const element = viewport.current!
    const anchor = createViewportAnchor(element)
    const track = anchor.track
    const resize = () => { anchor.resize(); setHeight(element.clientHeight) }
    setHeight(element.clientHeight)
    element.addEventListener('scroll', track, { passive: true })
    const initial = requestAnimationFrame(() => { element.scrollLeft = PAD * zoomRef.current / 100 - 16; element.scrollTop = PAD * zoomRef.current / 100 - 16; track() })
    const observer = new ResizeObserver(resize); observer.observe(element)
    return () => { observer.disconnect(); element.removeEventListener('scroll', track); cancelAnimationFrame(initial) }
  }, [])
  useEffect(() => {
    const element = viewport.current!
    const wheel = (event: WheelEvent) => {
      if (hasCanvasOverlay()) return
      const target = event.target as HTMLElement
      if (target.closest('.canvas-tools, .canvas-minimap')) return
      // Unmodified wheel events are always scrolling, even when a diagonal
      // trackpad gesture changes its dominant axis or continues with inertia.
      if (!event.ctrlKey && !event.metaKey) {
        wheelDelta.current = 0
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
        if (event.shiftKey || Math.abs(event.deltaX) > 0) {
          event.preventDefault()
          element.scrollLeft += (event.shiftKey ? event.deltaY || event.deltaX : event.deltaX) * unit
          const column = target.closest<HTMLElement>('.column-cards')
          if (!event.shiftKey) { if (column) column.scrollTop += event.deltaY * unit; else element.scrollTop += event.deltaY * unit }
        } else if (!target.closest('.column-cards')) {
          event.preventDefault(); element.scrollTop += event.deltaY * unit
        }
        return
      }
      // Browser trackpad pinch is ctrl+wheel; deliberate Cmd/Ctrl+wheel also zooms.
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      const rect = element.getBoundingClientRect()
      changeRef.current(zoomRef.current * Math.exp(-Math.max(-60, Math.min(60, delta)) * .004), event.clientX - rect.left, event.clientY - rect.top)
    }
    let pinch: { distance: number; zoom: number; x: number; y: number; left: number; top: number; mode: 'pan' | 'zoom' | null } | null = null
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const startPinch = (event: TouchEvent) => {
      if (event.touches.length !== 2 || (event.target as HTMLElement).closest('.canvas-tools, .canvas-minimap')) return
      event.preventDefault()
      gesture.current = null
      pinch = { distance: Math.max(1, distance(event.touches)), zoom: zoomRef.current, x: (event.touches[0].clientX + event.touches[1].clientX) / 2, y: (event.touches[0].clientY + event.touches[1].clientY) / 2, left: element.scrollLeft, top: element.scrollTop, mode: null }
    }
    const movePinch = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const x = (event.touches[0].clientX + event.touches[1].clientX) / 2
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2
      if (!pinch.mode) {
        if (Math.abs(distance(event.touches) - pinch.distance) > 10) pinch.mode = 'zoom'
        else if (Math.hypot(x-pinch.x, y-pinch.y) > 8) pinch.mode = 'pan'
        else return
      }
      if (pinch.mode === 'pan') { element.scrollLeft = pinch.left - (x-pinch.x); element.scrollTop = pinch.top - (y-pinch.y); return }
      const rect = element.getBoundingClientRect()
      changeRef.current(pinch.zoom * distance(event.touches) / pinch.distance, (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left, (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top)
    }
    const endPinch = () => { pinch = null }
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('touchstart', startPinch, { passive: false })
    element.addEventListener('touchmove', movePinch, { passive: false })
    element.addEventListener('touchend', endPinch)
    element.addEventListener('touchcancel', endPinch)
    return () => {
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('touchstart', startPinch)
      element.removeEventListener('touchmove', movePinch)
      element.removeEventListener('touchend', endPinch)
      element.removeEventListener('touchcancel', endPinch)
    }
  }, [])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const key = event.key.toLowerCase()
      if (document.querySelector('.card-drag-preview, .column-drag-preview')) return
      if (event.key === 'Escape') {
        if (!event.defaultPrevented && !event.isComposing && !hasCanvasOverlay()) {
          setPan(false); setSpacePan(false)
          if (fullscreenRef.current.active && !target.closest('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); void fullscreenRef.current.exit() }
        }
        return
      }
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]') || hasCanvasOverlay()) return
      // Leave Space and arrows to focused controls and keyboard card sorting.
      if ((target.closest('.card-tile') && key !== 'f') || ((event.code === 'Space' || event.key.startsWith('Arrow')) && target.closest('button, [role="button"], [role="slider"]'))) return
      if (event.code === 'Space') { event.preventDefault(); setSpacePan(true); return }
      if (event.repeat && ['h', 'm', 'f', '0'].includes(key)) return
      if (key === 'h') setPan(value => !value)
      else if (key === 'm') setMinimap(value => { save('squirrel.minimap', value ? '0' : '1'); return !value })
      else if (key === 'f') { if (event.shiftKey) actions.current.fit(); else { setPan(false); setSpacePan(false); void fullscreenRef.current.toggle() } }
      else if (key === '0') actions.current.reset()
      else if (key === '+' || key === '=') changeRef.current(zoomRef.current + 10)
      else if (key === '-') changeRef.current(zoomRef.current - 10)
      else if (target === viewport.current && key.startsWith('arrow')) {
        const delta: Record<string, [number, number]> = { arrowleft: [-80, 0], arrowright: [80, 0], arrowup: [0, -80], arrowdown: [0, 80] }
        const [left, top] = delta[key] || [0, 0]; viewport.current?.scrollBy({ left, top })
      } else return
      event.preventDefault()
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false) }
    const blur = () => { setSpacePan(false); setPan(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  function reset() { change(100); requestAnimationFrame(() => viewport.current?.scrollTo({ left: PAD - 16, top: PAD - 16 })) }
  function fit() {
    if (!viewport.current || !world.current) return
    const contentWidth = (world.current.querySelector('.kanban-columns')?.getBoundingClientRect().width ?? 1) / (zoomRef.current / 100)
    const next = clamp(Math.floor((viewport.current.clientWidth - 32) / Math.max(1, contentWidth) * 20) * 5)
    change(next); requestAnimationFrame(() => viewport.current?.scrollTo({ left: PAD * next / 100 - 16, top: PAD * next / 100 }))
  }
  actions.current = { reset, fit }
  return <div className="board-canvas">
    <div ref={viewport} className={cx('board-viewport', (pan || spacePan) && 'canvas-pan-mode')} aria-label={t("看板画布")} tabIndex={0}
      onPointerDownCapture={event => {
        if ((!pan && !spacePan && event.button !== 1) || (event.button !== 0 && event.button !== 1)) return
        const element = event.currentTarget
        element.focus({ preventScroll: true })
        event.preventDefault(); event.stopPropagation(); element.setPointerCapture(event.pointerId)
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
        element.classList.add('canvas-is-panning')
      }} onPointerMove={event => {
        const start = gesture.current
        if (!start || start.id !== event.pointerId) return
        event.currentTarget.scrollLeft = start.left - event.clientX + start.x
        event.currentTarget.scrollTop = start.top - event.clientY + start.y
      }} onPointerUp={event => {
        if (!gesture.current) return
        gesture.current = null; event.currentTarget.classList.remove('canvas-is-panning'); event.currentTarget.releasePointerCapture(event.pointerId)
      }} onLostPointerCapture={event => { gesture.current = null; event.currentTarget.classList.remove('canvas-is-panning') }}
      onClickCapture={event => { if (pan || spacePan) { event.preventDefault(); event.stopPropagation() } }}>
      <div ref={world} className="board-world" style={{ zoom: zoom / 100, minWidth: `calc(${10000 / zoom}% + 128px)`, minHeight: height / (zoom / 100) + PAD * 2 }}>
        <BoardScale.Provider value={zoom / 100}>{children(zoom / 100, Math.max(220, (height - 78) / (zoom / 100)))}</BoardScale.Provider>
      </div>
    </div>
    <div className="canvas-tools-group">
      <CanvasMinimap open={minimap} board={board} viewport={viewport} world={world} zoom={zoom} onClose={() => { setMinimap(false); save('squirrel.minimap', '0'); focusElement(minimapToggle.current) }} />
      <div className="canvas-tools" role="toolbar" aria-label={t("画布工具")}>
        <ToolHint text={pan ? t("拖动画布 · Esc 退出") : t("H 切换 · 空格拖动 · 鼠标中键")} align="start">
          <button className={cx('canvas-pan-button', pan && 'selected')} aria-label={t("移动画布")} aria-pressed={pan} onClick={() => setPan(value => !value)}><Icon name="hand" size={16} /><span>{t("移动画布")}</span></button>
        </ToolHint>
        <span className="canvas-tool-separator" />
        <ToolHint text={t("缩小 · −")}><button aria-label={t("缩小看板")} disabled={zoom <= 25} onClick={() => change(zoom - 10)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button></ToolHint>
        <ToolHint text={t("空白处滚轮缩放 · 双指捏合")}>
          <input type="range" min={25} max={150} step={5} value={zoom} style={{ '--zoom-fill': `${(zoom - 25) / 125 * 100}%` } as CSSProperties} aria-label={t("看板缩放比例")} aria-valuetext={`${zoom}%`} onChange={event => change(Number(event.target.value))} />
        </ToolHint>
        <ToolHint text={t("放大 · +")}><button aria-label={t("放大看板")} disabled={zoom >= 150} onClick={() => change(zoom + 10)}><Icon name="plus" size={14} /></button></ToolHint>
        <span className="canvas-percent" aria-live="polite">{zoom}%</span>
        <ToolHint text={t("恢复 100% 并回到起点 · 0")} align="end"><button aria-label={t("重置画布")} onClick={reset}><Icon name="refresh" size={15} /></button></ToolHint>
        <ToolHint text={t("完整展示所有列表 · Shift + F")} align="end"><button aria-label={t("适应画布宽度")} onClick={fit}>{t("适应")}</button></ToolHint>
        <span className="canvas-tool-separator" />
        <ToolHint text={minimap ? t("收起缩略图 · M") : t("展开缩略图 · M")} align="end"><button ref={minimapToggle} aria-label={minimap ? t("关闭缩略图") : t("打开缩略图")} aria-pressed={minimap} aria-expanded={minimap} className={cx(minimap && 'selected')} onClick={() => { setMinimap(value => !value); save('squirrel.minimap', minimap ? '0' : '1') }}><Icon name="minimap" size={17} /></button></ToolHint>
        <ToolHint text={fullscreen.active ? t("退出全屏 · F / Esc") : t("全屏画布 · F")} align="end"><button type="button" aria-label={fullscreen.active ? t("退出全屏") : t("全屏画布")} aria-pressed={fullscreen.active} aria-keyshortcuts="F" className={cx(fullscreen.active && 'selected')} onClick={() => { setPan(false); setSpacePan(false); void fullscreen.toggle() }}><Icon name={fullscreen.active ? 'fullscreenExit' : 'fullscreen'} size={17} /></button></ToolHint>
      </div>
    </div>
  </div>
}

function ToolHint({ text, align, children }: { text: string; align?: 'start' | 'end'; children: ReactNode }) {
  useLanguage()
  const id = useId()
  return <span className="canvas-tool" data-align={align} aria-describedby={id}>
    {children}<span className="canvas-tooltip" id={id} role="tooltip">{text}</span>
  </span>
}

type MapRect = { x: number; y: number; width: number; height: number }
function CanvasMinimap({ open, board, viewport, world, zoom, onClose }: { open: boolean; board: BoardDetail; viewport: RefObject<HTMLDivElement>; world: RefObject<HTMLDivElement>; zoom: number; onClose: () => void }) {
  useLanguage()
  const presence = usePresence(open)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [map, setMap] = useState({ width: 1, height: 1, x: 0, y: 0, vw: 1, vh: 1, columns: [] as (MapRect & { cards: (MapRect & { title: string })[] })[] })
  useEffect(() => {
    if (!presence.mounted) return
    const element = viewport.current!, content = world.current!
    let frame = 0, geometryDirty = true
    const update = () => {
      frame = 0
      if (!geometryDirty) {
        setMap(previous => ({ ...previous, x: element.scrollLeft, y: element.scrollTop }))
        return
      }
      geometryDirty = false
      const origin = content.getBoundingClientRect()
      const columns = [...content.querySelectorAll('.kanban-column')].map(column => {
        const rect = column.getBoundingClientRect()
        const list = column.querySelector('.column-cards')?.getBoundingClientRect() ?? rect
        const cards = [...column.querySelectorAll('.card-tile')].flatMap(card => {
          const box = card.getBoundingClientRect(), top = Math.max(box.top, list.top), bottom = Math.min(box.bottom, list.bottom)
          return bottom > top ? [{ x: box.left - origin.left, y: top - origin.top, width: box.width, height: bottom - top, title: card.getAttribute('aria-label') || '' }] : []
        })
        return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height, cards }
      })
      setMap({ width: element.scrollWidth, height: element.scrollHeight, x: element.scrollLeft, y: element.scrollTop, vw: element.clientWidth, vh: element.clientHeight, columns })
    }
    const schedule = () => { geometryDirty = true; if (!frame) frame = requestAnimationFrame(update) }
    const scroll = (event: Event) => { if (event.target !== element) geometryDirty = true; if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule); observer.observe(element); observer.observe(content)
    content.querySelectorAll('.kanban-column').forEach(column => observer.observe(column))
    const mutations = new MutationObserver(schedule); mutations.observe(content, { childList: true, subtree: true })
    element.addEventListener('scroll', scroll, { passive: true, capture: true }); schedule()
    return () => { observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); element.removeEventListener('scroll', scroll, true) }
  }, [board, viewport, world, zoom, presence.mounted])
  // Crop only to content; viewport movement must never change the map scale.
  const bounds = map.columns.length ? {
    x: Math.min(...map.columns.map(column => column.x)) - 18,
    y: Math.min(...map.columns.map(column => column.y)) - 18,
    right: Math.max(...map.columns.map(column => column.x + column.width)) + 18,
    bottom: Math.max(...map.columns.map(column => column.y + column.height)) + 18,
  } : { x: 0, y: 0, right: 320, bottom: 120 }
  const mapWidth = bounds.right - bounds.x, mapHeight = bounds.bottom - bounds.y
  const previewHeight = Math.max(64, Math.min(180, 276 * mapHeight / mapWidth))
  const scale = Math.min(276 / mapWidth, previewHeight / mapHeight)
  const visible = { x: Math.max(bounds.x, map.x), y: Math.max(bounds.y, map.y), right: Math.min(bounds.right, map.x + map.vw), bottom: Math.min(bounds.bottom, map.y + map.vh) }
  function point(clientX: number, clientY: number, target: SVGSVGElement) {
    const matrix = target.getScreenCTM()
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null
  }
  function navigate(clientX: number, clientY: number, target: SVGSVGElement) {
    const cursor = point(clientX, clientY, target), start = drag.current
    if (!cursor || !start) return
    viewport.current?.scrollTo({ left: cursor.x - start.x, top: cursor.y - start.y })
  }
  if (!presence.mounted) return null
  return <div className="canvas-minimap" data-motion={presence.phase} aria-label={t("看板缩略图")} aria-hidden={!open || undefined} {...(!open ? { inert: '' } : {})} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="canvas-minimap-heading"><span>{t("缩略图")}</span><ToolHint text={t("收起缩略图")} align="end"><button onClick={onClose} aria-label={t("关闭缩略图")}><Icon name="close" size={13} /></button></ToolHint></div>
    <div className="canvas-minimap-preview">
      <svg role="button" tabIndex={0} aria-label={t("缩略图定位：拖动视口框或点击定位，方向键移动画布")} onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-120, 0], ArrowRight: [120, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }
        const delta = directions[event.key]
        if (delta) { event.preventDefault(); viewport.current?.scrollBy({ left: delta[0], top: delta[1] }) }
        if (event.key === 'Home') { event.preventDefault(); viewport.current?.scrollTo({ left: 0, top: 0 }) }
      }} width="276" height={previewHeight} viewBox={`${bounds.x} ${bounds.y} ${mapWidth} ${mapHeight}`} onPointerDown={event => {
        if (event.button !== 0) return
        const cursor = point(event.clientX, event.clientY, event.currentTarget)
        if (!cursor) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        const inside = cursor.x >= map.x && cursor.x <= map.x + map.vw && cursor.y >= map.y && cursor.y <= map.y + map.vh
        drag.current = { id: event.pointerId, x: inside ? cursor.x - map.x : map.vw / 2, y: inside ? cursor.y - map.y : map.vh / 2 }
        event.currentTarget.classList.add('is-panning'); navigate(event.clientX, event.clientY, event.currentTarget)
      }} onPointerMove={event => { if (drag.current?.id === event.pointerId) navigate(event.clientX, event.clientY, event.currentTarget) }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onLostPointerCapture={event => { drag.current = null; event.currentTarget.classList.remove('is-panning') }}>
        {map.columns.map(({ cards, ...column }, index) => <g key={board.columns[index]?.id ?? index}>
          <rect {...column} rx={12} fill="var(--surface)" stroke="var(--line)" />
          <rect x={column.x + 12} y={column.y + 12} width={Math.max(1, column.width - 24)} height={5} rx={2} fill={board.columns[index]?.color || 'var(--accent)'} opacity=".7" />
          <text x={column.x + 12} y={column.y + 10 / scale} fontSize={8 / scale} fill="var(--ink)">{(board.columns[index]?.name || '').slice(0, Math.max(2, Math.floor(column.width * scale / 9) - 1))}</text>
          {cards.map(({ title, ...card }, row) => <g key={row}><rect {...card} rx={5} fill="var(--selected)" stroke="var(--line)" vectorEffect="non-scaling-stroke" strokeWidth=".5" />{card.height * scale > 12 && <text x={card.x + 8} y={card.y + 10 / scale} fontSize={8 / scale} fill="var(--muted)">{title.slice(0, Math.max(2, Math.floor(card.width * scale / 9) - 1))}</text>}</g>)}
        </g>)}
        <rect className="minimap-viewport" x={visible.x} y={visible.y} width={Math.max(0, visible.right - visible.x)} height={Math.max(0, visible.bottom - visible.y)} rx={8} fill="var(--accent)" fillOpacity=".035" stroke="var(--accent)" strokeOpacity=".55" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
    <div className="canvas-minimap-footer"><span>{t("拖动视口定位")}</span><span>{zoom}%</span></div>
  </div>
}
