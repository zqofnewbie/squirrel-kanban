import { focusElement, keyboardFocus } from './focus'
import { useEffect, useRef, type RefObject } from 'react'

export function useDialogFocus(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open || !ref.current) return
    const previous = document.activeElement as HTMLElement | null
    let keyboardNavigation = keyboardFocus()
    const panel = ref.current
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length)
    focusElement(panel.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)') ?? controls()[0] ?? panel, keyboardNavigation)
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]):not(.motion-layer[data-motion="exit"] [role="dialog"])')
      if (dialogs[dialogs.length - 1] !== panel) return
      if (document.querySelector('[role="menu"]:not([aria-hidden="true"])')) return
      if (event.key === 'Escape' && (event.target as HTMLElement)?.closest('[data-escape-local]')) return
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current() }
      if (event.key === 'Tab') {
        keyboardNavigation = true
        const items = controls()
        if (!items.length) { event.preventDefault(); focusElement(panel, true); return }
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); focusElement(last, true) }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); focusElement(first, true) }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (!previous?.isConnected) return
      focusElement(previous, keyboardNavigation)
    }
  // onClose is kept fresh without tearing down focus on each keystroke.
  }, [ref, open])
}
