// Shared by dialogs, menus and inline editors. Only one restored focus target
// can be active; the next user action or blur removes its temporary styling.
let keyboard = false
let clearRestored: (() => void) | undefined
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { keyboard = false; clearRestored?.() }, true)
  window.addEventListener('keydown', event => {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    keyboard = true
    clearRestored?.()
  }, true)
}
export const keyboardFocus = () => keyboard
export function focusElement(element: HTMLElement | null | undefined, visible = keyboard) {
  if (!element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return
  clearRestored?.()
  // Text inputs retain their normal editing appearance.
  if (element !== document.body && !element.matches('input, textarea, select, [contenteditable]')) {
    const attribute = visible ? 'data-keyboard-focus-restored' : 'data-pointer-focus-restored'
    element.setAttribute(attribute, '')
    const clear = () => {
      element.removeAttribute(attribute)
      element.removeEventListener('blur', clear)
      if (clearRestored === clear) clearRestored = undefined
    }
    clearRestored = clear
    element.addEventListener('blur', clear, { once: true })
  }
  element.focus({ preventScroll: true })
  if (document.activeElement !== element) clearRestored?.()
}
