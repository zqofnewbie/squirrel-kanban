import { useEffect, useState, type RefObject, type ReactNode } from 'react'
import Icon from './Icon'
import { t } from './i18n'
import { useLanguage } from './useLanguage'
const SCROLL_THRESHOLD_RATIO = 0.12
export default function ColumnScrollFooter({
  target,
  children,
}: {
  target: RefObject<HTMLDivElement>
  children?: ReactNode
}) {
  useLanguage()
  const [state, setState] = useState({ scrollable: false, top: true, bottom: true })
  useEffect(() => {
    const el = target.current
    if (!el) return
    const update = () => {
      const max = el.scrollHeight - el.clientHeight
      const next = {
        scrollable: max > el.clientHeight * SCROLL_THRESHOLD_RATIO,
        top: el.scrollTop <= 2,
        bottom: max - el.scrollTop <= 2,
      }
      setState((old) =>
        old.scrollable === next.scrollable && old.top === next.top && old.bottom === next.bottom
          ? old
          : next,
      )
    }
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(el)
      for (const child of el.children) resize.observe(child)
      schedule()
    }
    const mutation = new MutationObserver(observeChildren)
    mutation.observe(el, { childList: true, subtree: true })
    observeChildren()
    return () => {
      el.removeEventListener('scroll', schedule)
      resize.disconnect()
      mutation.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [target])
  const scroll = (bottom: boolean) =>
    target.current?.scrollTo({
      top: bottom ? target.current.scrollHeight : 0,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  if (!children && !state.scrollable) return null
  return (
    <div className="column-scroll-footer">
      {state.scrollable && (
        <button
          className="column-scroll-edge"
          disabled={state.top}
          aria-label={t('回到顶部')}
          title={t('回到顶部')}
          onClick={() => scroll(false)}
        >
          <Icon name="back" className="rotate-90" size={14} />
        </button>
      )}
      <div className="column-scroll-add">{children}</div>
      {state.scrollable && (
        <button
          className="column-scroll-edge"
          disabled={state.bottom}
          aria-label={t('回到底部')}
          title={t('回到底部')}
          onClick={() => scroll(true)}
        >
          <Icon name="back" className="-rotate-90" size={14} />
        </button>
      )}
    </div>
  )
}
