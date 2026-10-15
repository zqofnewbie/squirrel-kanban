import MorphingIcon from './MorphingIcon'
import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusElement, keyboardFocus } from './focus'
import { useLanguage } from './useLanguage'
import { usePresence } from './usePresence'
import { t } from './i18n'
import Icon from './Icon'

function classes(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(' ')
}

export function Menu({
  trigger,
  children,
  align = 'right',
  width = 200,
  matchTriggerWidth = false,
  className,
  openOnHover = false,
  disabled = false,
  placement = 'bottom',
}: {
  className?: string
  trigger: (open: boolean, toggle: () => void) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
  matchTriggerWidth?: boolean
  placement?: 'bottom' | 'top-end' | 'right-start'
  openOnHover?: boolean
  disabled?: boolean
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
  const [position, setPosition] = useState({ left: 0, top: 0, width, ready: false })
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const hoverOpened = useRef(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>()
  const clearHover = () => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = undefined
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  React.useLayoutEffect(() => {
    if (disabled) {
      clearHover()
      setOpen(false)
    }
  }, [disabled])
  const hoverEnter = (event: React.MouseEvent) => {
    clearHover()
    if (!disabled && event.buttons === 0 && openOnHover && !open) {
      hoverOpened.current = true
      setOpen(true)
    }
  }
  const hoverLeave = () => {
    if (openOnHover && hoverOpened.current) {
      clearHover()
      hoverTimer.current = setTimeout(() => setOpen(false), 250)
    }
  }
  const focusLast = useRef(false)
  const focusTrigger = (visible = keyboardFocus()) =>
    focusElement(box.current?.querySelector<HTMLButtonElement>('button'), visible)
  const close = () => {
    const visible = keyboardFocus()
    setOpen(false)
    focusTrigger(visible)
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) focusTrigger(visible)
    })
  }
  React.useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = box.current?.getBoundingClientRect()
      if (!anchor) return
      const size = Math.min(matchTriggerWidth ? anchor.width : width, window.innerWidth - 16)
      const height = menu.current?.offsetHeight ?? 0
      const sideLeft =
        anchor.right + size + 14 <= window.innerWidth ? anchor.right + 6 : anchor.left - size - 6
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - size - 8,
          placement === 'right-start'
            ? sideLeft
            : align === 'left'
              ? anchor.left
              : anchor.right - size,
        ),
      )
      const top =
        placement === 'right-start'
          ? Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8))
          : placement === 'top-end' && anchor.top > height + 8
            ? anchor.top - height - 6
            : anchor.bottom + height + 8 > window.innerHeight && anchor.top > height + 8
              ? anchor.top - height - 6
              : Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))
      setPosition({ left, top, width: size, ready: true })
    }
    place()
    const items = () =>
      Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
      )
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node))
        setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key === 'Tab') {
        setOpen(false)
        focusTrigger()
        return
      }
      if (!(document.activeElement as HTMLElement)?.matches('[role="menuitem"]')) return
      const list = items()
      const index = list.indexOf(document.activeElement as HTMLButtonElement)
      let next: number | undefined
      if (e.key === 'ArrowDown') next = (index + 1) % list.length
      if (e.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
      if (e.key === 'Home') next = 0
      if (e.key === 'End') next = list.length - 1
      if (next !== undefined) {
        e.preventDefault()
        focusElement(list[next], true)
      }
    }
    // Treat the small gap between the trigger and its portal as part of the menu.
    const onMove = (event: PointerEvent) => {
      if (!openOnHover || !hoverOpened.current || event.pointerType !== 'mouse') return
      const a = box.current?.getBoundingClientRect(),
        b = menu.current?.getBoundingClientRect()
      if (!a || !b) return
      const inside = (r: DOMRect) =>
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      const gapTop = b.bottom <= a.top ? b.bottom : a.bottom
      const gapBottom = b.bottom <= a.top ? a.top : b.top
      const sideGapLeft = b.left >= a.right ? a.right : b.right
      const sideGapRight = b.left >= a.right ? b.left : a.left
      const sideBridge =
        event.clientX >= sideGapLeft &&
        event.clientX <= sideGapRight &&
        event.clientY >= Math.min(a.top, b.top) &&
        event.clientY <= Math.max(a.bottom, b.bottom)
      const bridge =
        event.clientX >= Math.min(a.left, b.left) &&
        event.clientX <= Math.max(a.right, b.right) &&
        event.clientY >= gapTop &&
        event.clientY <= gapBottom
      if (inside(a) || inside(b) || bridge || sideBridge) clearHover()
      else if (!hoverTimer.current) hoverLeave()
    }
    const onScroll = (event: Event) => {
      if (openOnHover && !menu.current?.contains(event.target as Node)) {
        clearHover()
        setOpen(false)
        return
      }
      place()
    }
    const observer = new ResizeObserver(place)
    if (menu.current) observer.observe(menu.current)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('fullscreenchange', place)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('fullscreenchange', place)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, align, width, matchTriggerWidth, placement, openOnHover])
  useEffect(() => {
    if (!open || !position.ready || hoverOpened.current) return
    const input = menu.current?.querySelector<HTMLInputElement>('input, textarea')
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    )
    focusElement(input ?? (focusLast.current ? items[items.length - 1] : items[0]))
  }, [open, position.ready])
  const control = trigger(open, () => {
    if (disabled) return
    clearHover()
    focusLast.current = false
    if (hoverOpened.current) {
      hoverOpened.current = false
      setOpen(true)
    } else setOpen((v) => !v)
  })
  return (
    <div
      className={classes('relative inline-flex min-w-0', className)}
      ref={box}
      onMouseEnter={openOnHover ? hoverEnter : undefined}
      onMouseLeave={openOnHover ? hoverLeave : undefined}
    >
      {React.isValidElement(control)
        ? React.cloneElement(control as React.ReactElement<any>, {
            id,
            disabled: disabled || (control.props as any).disabled,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (disabled) return
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                hoverOpened.current = false
                focusLast.current = e.key === 'ArrowUp'
                setOpen(true)
              } else (control.props as any).onKeyDown?.(e)
            },
          })
        : control}
      {presence.mounted &&
        createPortal(
          <div
            data-motion={presence.phase}
            aria-hidden={!open || undefined}
            {...(!open ? { inert: '' } : {})}
            ref={menu}
            onMouseEnter={openOnHover ? clearHover : undefined}
            onMouseLeave={openOnHover ? hoverLeave : undefined}
            role="menu"
            aria-labelledby={id}
            className="motion-panel menu-panel scroll-thin pop fixed z-[90] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-lift"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: 'calc(100dvh - 16px)',
              visibility: position.ready ? 'visible' : 'hidden',
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={classes(
        'flex min-h-9 items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 [&>svg]:shrink-0 [&>svg]:h-4 [&>svg]:w-4',
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
      )}
    >
      {children}
    </button>
  )
}

export function Select({
  value,
  options,
  onChange,
  disabled,
  label,
  className,
  fullWidth = false,
}: {
  className?: string
  fullWidth?: boolean
  value: number
  options: { value: number; label: string; color?: string }[]
  onChange: (value: number) => void | Promise<unknown>
  disabled?: boolean
  label: string
}) {
  useLanguage()
  const selected = options.find((option) => option.value === value)
  return (
    <Menu
      align="left"
      width={240}
      matchTriggerWidth={fullWidth}
      className={classes(fullWidth && 'w-full', className)}
      trigger={(open, toggle) => (
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          onClick={toggle}
          className="select-trigger"
        >
          <span className="truncate">{selected?.label ?? t('选择列表')}</span>
          <MorphingIcon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              onClick={async () => {
                if (!disabled) {
                  await onChange(option.value)
                  close()
                }
              }}
            >
              <span className="column-color-dot" style={{ background: option.color }} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && <Icon name="check" size={14} />}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

export function MenuSep() {
  useLanguage()
  return <div className="my-1 h-px bg-black/[0.07] dark:bg-white/[0.08]" />
}
