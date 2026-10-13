import { useEffect, useRef, type RefObject } from 'react'

export function useDialogFocus(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const keyboard = useRef(false)
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) keyboard.current = true }
    const pointer = () => { keyboard.current = false }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', pointer, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', pointer, true) }
  }, [])
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open || !ref.current) return
    const previous = document.activeElement as HTMLElement | null
    let keyboardNavigation = keyboard.current
    const panel = ref.current
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length)
    ;(panel.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)') ?? controls()[0] ?? panel).focus()
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]):not(.motion-layer[data-motion="exit"] [role="dialog"])')
      if (dialogs[dialogs.length - 1] !== panel) return
      if (document.querySelector('[role="menu"]:not([aria-hidden="true"])')) return
      if (event.key === 'Escape' && (event.target as HTMLElement)?.closest('[data-escape-local]')) return
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current() }
      if (event.key === 'Tab') {
        keyboardNavigation = true
        const items = controls()
        if (!items.length) { event.preventDefault(); panel.focus(); return }
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (!previous?.isConnected) return
      // Typing in a dialog can make the browser paint :focus-visible on the
      // pointer-opened card when focus returns. Keep focus without that ring.
      {
        const attribute = keyboardNavigation ? 'data-keyboard-focus-restored' : 'data-pointer-focus-restored'
        previous.setAttribute(attribute, '')
        const clear = () => {
          previous.removeAttribute(attribute)
          previous.removeEventListener('blur', clear)
          window.removeEventListener('keydown', clear, true)
          window.removeEventListener('pointerdown', clear, true)
        }
        previous.addEventListener('blur', clear, { once: true })
        window.addEventListener('keydown', clear, true)
        window.addEventListener('pointerdown', clear, true)
      }
      previous.focus({ preventScroll: true })
    }
  // onClose is kept fresh without tearing down focus on each keystroke.
  }, [ref, open])
}
