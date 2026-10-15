import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useStore } from './store'
import Icon from './Icon'

export default function ThemeToggle() {
  useLanguage()
  const theme = useStore((s) => s.theme)
  const [busy, setBusy] = useState(false)
  async function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    if (busy) return
    const next = theme === 'dark' ? 'light' : 'dark'
    const start = (
      document as Document & {
        startViewTransition?: (callback: () => void) => {
          ready: Promise<void>
          finished: Promise<void>
        }
      }
    ).startViewTransition
    if (!start || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      useStore.getState().setTheme(next)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2,
      y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    setBusy(true)
    document.documentElement.classList.add('theme-transition')
    const transition = start.call(document, () =>
      flushSync(() => useStore.getState().setTheme(next)),
    )
    try {
      await transition.ready
      await document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 520,
          easing: 'cubic-bezier(.2,.7,.2,1)',
          pseudoElement: '::view-transition-new(root)',
        },
      ).finished
    } catch {
      /* Hidden tabs or unsupported pseudo-element animation still switch themes. */
    } finally {
      await transition.finished.catch(() => {})
      document.documentElement.classList.remove('theme-transition')
      setBusy(false)
    }
  }
  return (
    <button
      disabled={busy}
      onClick={(event) => void toggle(event)}
      title={theme === 'dark' ? t('切换到明亮主题') : t('切换到深色主题')}
      aria-label={t('切换主题')}
      className="theme-toggle"
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  )
}
