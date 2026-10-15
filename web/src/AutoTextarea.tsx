import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react'

export function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.overflowY = 'hidden'
  element.style.height = 'auto'
  const style = getComputedStyle(element)
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  const desired = Math.ceil(
    element.scrollHeight +
      (style.boxSizing === 'border-box'
        ? border
        : -parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
  )
  const limit = parseFloat(style.maxHeight)
  const height = Number.isFinite(limit) ? Math.min(desired, limit) : desired
  element.style.height = `${height}px`
  element.style.overflowY = desired > height + 1 ? 'auto' : 'hidden'
}

export type AutoTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxCharacters?: number
}
export default forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea(
  { maxCharacters, onChange, ...props },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const attach = useCallback(
    (element: HTMLTextAreaElement | null) => {
      ref.current = element
      if (typeof forwarded === 'function') forwarded(element)
      else if (forwarded) forwarded.current = element
    },
    [forwarded],
  )
  useLayoutEffect(() => {
    if (ref.current) resizeTextarea(ref.current)
  }, [props.value, props.defaultValue, props.rows, props.placeholder])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let width = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      resizeTextarea(element)
    })
    const resize = () => resizeTextarea(element)
    observer.observe(element)
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])
  return (
    <textarea
      {...props}
      onChange={(event) => {
        const next = event.target.value
        const previous = String(props.value ?? '')
        if (
          maxCharacters &&
          [...next].length > maxCharacters &&
          [...next].length >= [...previous].length
        ) {
          event.target.value = previous
          return
        }
        onChange?.(event)
      }}
      ref={attach}
      className={`auto-textarea ${props.className || ''}`}
      onInput={(event) => {
        resizeTextarea(event.currentTarget)
        props.onInput?.(event)
      }}
    />
  )
})
