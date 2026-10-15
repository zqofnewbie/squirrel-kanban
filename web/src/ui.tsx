import AutoTextarea from './AutoTextarea'
import { focusElement, keyboardFocus } from './focus'
import { useLanguage } from './useLanguage'
import { t, locale } from './i18n'
import Icon from './Icon'
import { usePresence } from './usePresence'
import { createPortal } from 'react-dom'
import { useDialogFocus } from './useDialogFocus'
import React, { useEffect, useId, useRef, useState } from 'react'

export function cx(...v: (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

// ---------- 按钮 ----------

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'soft'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: BtnProps) {
  useLanguage()
  const base =
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]'
  const variants = {
    primary: 'button-primary',
    soft: 'bg-black/[0.04] hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]',
    ghost:
      'border border-black/[0.12] hover:bg-black/[0.04] dark:border-white/[0.14] dark:hover:bg-white/[0.08]',
    danger: 'border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800/60 dark:text-red-400 dark:hover:bg-red-950/40',
  }[variant]
  return <button type="button" className={cx(base, sizes, variants, className)} {...rest} />
}

// ---------- 输入 ----------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
      className={cx(
        'h-9 min-w-0 w-full leading-normal rounded-lg border border-black/[0.12] bg-white px-3 text-[13px] outline-none',
        'placeholder:text-black/30 focus:border-brand-400',
        'dark:border-white/[0.14] dark:bg-white/[0.06] dark:placeholder:text-white/30',
        props.className,
      )}
    />
    )
  },
)

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className, disabled, ...props }, ref) {
    useLanguage()
    const [visible, setVisible] = useState(false)
    return <span className="password-field">
      <Input {...props} ref={ref} disabled={disabled} type={visible ? 'text' : 'password'} className={cx('password-field-input', className)} />
      <button type="button" className="password-visibility" disabled={disabled} aria-label={t(visible ? "隐藏密码" : "显示密码")} title={t(visible ? "隐藏密码" : "显示密码")} aria-pressed={visible} onMouseDown={e => e.preventDefault()} onClick={() => setVisible(value => !value)}><Icon name={visible ? 'eyeOff' : 'eye'} size={17} /></button>
    </span>
  },
)

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  useLanguage()
  return (
    <AutoTextarea
      {...props}
      className={cx(
        'w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none resize-none',
        'placeholder:text-black/30 focus:border-brand-400',
        'dark:border-white/[0.14] dark:bg-white/[0.06] dark:placeholder:text-white/30',
        props.className,
      )}
    />
  )
}

// ---------- 就地编辑文本 ----------

export function InlineText({
  value,
  onSave,
  className,
  multiline,
  placeholder,
}: {
  value: string
  onSave: (v: string) => void
  className?: string
  multiline?: boolean
  placeholder?: string
}) {
  useLanguage()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== value) onSave(v)
    else setDraft(value)
  }

  if (editing) {
    return (
      <AutoTextarea
        ref={ref}
        value={draft}
        rows={multiline ? 3 : 1}
        onChange={(e) => {
          setDraft(e.target.value)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !multiline && !e.nativeEvent.isComposing) {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(value)
            setEditing(false)
          }
        }}
        className={cx(
          'w-full resize-none rounded-md border border-brand-400 bg-white px-2 py-1 text-[13px] outline-none dark:bg-white/[0.08]',
          className,
        )}
      />
    )
  }
  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      className={cx('cursor-text whitespace-pre-wrap break-words', className)}
      title={t("双击编辑")}
    >
      {value || <span className="opacity-40">{placeholder ?? t("（空）")}</span>}
    </div>
  )
}

// ---------- 对话框（替代浏览器原生 prompt/confirm） ----------

export function PromptDialog({
  open,
  title,
  label,
  initial = '',
  placeholder,
  okText = t("确定"),
  onOK,
  onClose,
}: {
  open: boolean
  title: string
  label?: string
  initial?: string
  placeholder?: string
  okText?: string
  onOK: (v: string) => void | Promise<void>
  onClose: () => void
}) {
  useLanguage()
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [draft, setDraft] = useState(initial)
  useEffect(() => {
    if (open) { setDraft(initial); setFailure('') }
  }, [open, initial])

  const submit = async () => {
    const v = draft.trim()
    if (!v || busy) return
    setBusy(true)
    try { await onOK(v); onClose() } catch (e: any) { setFailure(e?.message ?? t("保存失败，请重试")) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose() }} title={title} width={380}>
      {failure && <p role="alert" className="mb-3 text-[12px] text-red-600">{failure}</p>}
      {label && <label htmlFor={inputId} className="mb-1.5 block text-[12px] opacity-65">{label}</label>}
      <Input
        id={inputId}
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button disabled={busy} onClick={onClose}>{t("取消")}</Button>
        <Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void submit()}>
          {busy ? t("保存中…") : okText}
        </Button>
      </div>
    </Modal>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  danger,
  okText = t("确定"),
  onOK,
  onClose,
}: {
  open: boolean
  title: string
  message: React.ReactNode
  danger?: boolean
  okText?: string
  onOK: () => void | Promise<void>
  onClose: () => void
}) {
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => { if (open) setFailure('') }, [open])
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose() }} title={title} width={380}>
      <div className="text-[13px] leading-relaxed opacity-80">{message}</div>
      {failure && <p role="alert" className="mt-3 text-[12px] text-red-600">{failure}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button disabled={busy} onClick={onClose}>{t("取消")}</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await onOK(); onClose() } catch (e: any) { setFailure(e?.message ?? t("操作失败，请重试")) } finally { setBusy(false) }
          }}
        >
          {busy ? t("保存中…") : okText}
        </Button>
      </div>
    </Modal>
  )
}

// ---------- 弹层 ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
  placement = 'center',
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
  placement?: 'center' | 'right'
  footer?: React.ReactNode
}) {
  useLanguage()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const presence = usePresence(open)
  const content = useRef(children)
  const lastTitle = useRef(title)
  if (open) { content.current = children; lastTitle.current = title }
  useDialogFocus(panelRef, open, onClose)

  if (!presence.mounted) return null
  return createPortal(
    <div data-motion={presence.phase} aria-hidden={!open || undefined} {...(!open ? { inert: '' } : {})} className={`motion-layer modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 ${placement === 'right' ? 'modal-drawer' : ''}`}>
      <div className="fade-in absolute inset-0 bg-black/35" onClick={() => { if (open) onClose() }} />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="pop relative flex flex-col max-h-[85dvh] overflow-hidden w-[calc(100vw-32px)] rounded-xl border border-black/[0.08] bg-white shadow-lift dark:border-white/[0.1] dark:bg-[#232327]"
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.07] px-5 py-4 dark:border-white/[0.08]">
          <h3 id={titleId} className="min-w-0 break-words text-[15px] font-medium">{lastTitle.current}</h3>
          <button
            onClick={onClose}
            aria-label={t("关闭对话框")}
            className="grid h-7 w-7 place-items-center rounded-md text-[16px] leading-none opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{open ? children : content.current}</div>
        {footer && <div className="modal-footer shrink-0 border-t border-[var(--line)] px-5 py-3">{footer}</div>}
      </div>
    </div>, document.body
  )
}

// ---------- 下拉菜单 ----------

export function Menu({ trigger, children, align = 'right', width = 200, matchTriggerWidth = false, className }: {
  className?: string
  trigger: (open: boolean, toggle: () => void) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
  matchTriggerWidth?: boolean
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
  const [position, setPosition] = useState({ left: 0, top: 0, width, ready: false })
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const focusLast = useRef(false)
  const focusTrigger = (visible = keyboardFocus()) => focusElement(box.current?.querySelector<HTMLButtonElement>('button'), visible)
  const close = () => { const visible = keyboardFocus(); setOpen(false); focusTrigger(visible); requestAnimationFrame(() => { if (document.activeElement === document.body) focusTrigger(visible) }) }
  React.useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = box.current?.getBoundingClientRect()
      if (!anchor) return
      const size = Math.min(matchTriggerWidth ? anchor.width : width, window.innerWidth - 16)
      const height = menu.current?.offsetHeight ?? 0
      const left = Math.max(8, Math.min(window.innerWidth - size - 8, align === 'left' ? anchor.left : anchor.right - size))
      const top = anchor.bottom + height + 8 > window.innerHeight && anchor.top > height + 8 ? anchor.top - height - 6 : Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))
      setPosition({ left, top, width: size, ready: true })
    }
    place()
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
      if (e.key === 'Tab') { setOpen(false); focusTrigger(); return }
      if (!(document.activeElement as HTMLElement)?.matches('[role="menuitem"]')) return
      const list = items(); const index = list.indexOf(document.activeElement as HTMLButtonElement)
      let next: number | undefined
      if (e.key === 'ArrowDown') next = (index + 1) % list.length
      if (e.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
      if (e.key === 'Home') next = 0
      if (e.key === 'End') next = list.length - 1
      if (next !== undefined) { e.preventDefault(); focusElement(list[next], true) }
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, align, width, matchTriggerWidth])
  useEffect(() => {
    if (!open || !position.ready) return
    const input = menu.current?.querySelector<HTMLInputElement>('input, textarea')
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    focusElement(input ?? (focusLast.current ? items[items.length - 1] : items[0]))
  }, [open, position.ready])
  const control = trigger(open, () => { focusLast.current = false; setOpen(v => !v) })
  return <div className={cx("relative inline-flex min-w-0", className)} ref={box}>
    {React.isValidElement(control) ? React.cloneElement(control as React.ReactElement<any>, {
      id, 'aria-haspopup': 'menu', 'aria-expanded': open,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusLast.current = e.key === 'ArrowUp'; setOpen(true) }
        else (control.props as any).onKeyDown?.(e)
      },
    }) : control}
    {presence.mounted && createPortal(<div data-motion={presence.phase} aria-hidden={!open || undefined} {...(!open ? { inert: '' } : {})} ref={menu} role="menu" aria-labelledby={id} className="motion-panel menu-panel scroll-thin pop fixed z-[90] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-lift" style={{ left: position.left, top: position.top, width: position.width, maxHeight: 'calc(100dvh - 16px)', visibility: position.ready ? 'visible' : 'hidden' }}>{children(close)}</div>, document.body)}
  </div>
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
      className={cx(
        'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
        danger ? 'text-red-600 dark:text-red-400' : '',
      )}
    >
      {children}
    </button>
  )
}


export function Select({ value, options, onChange, disabled, label, className, fullWidth = false }: { className?: string; fullWidth?: boolean; value: number; options: { value: number; label: string; color?: string }[]; onChange: (value: number) => void | Promise<unknown>; disabled?: boolean; label: string }) {
  useLanguage()
  const selected = options.find(option => option.value === value)
  return <Menu align="left" width={240} matchTriggerWidth={fullWidth} className={cx(fullWidth && "w-full", className)} trigger={(_, toggle) => <button type="button" disabled={disabled} aria-label={label} onClick={toggle} className="select-trigger"><span className="truncate">{selected?.label ?? t("选择列表")}</span><Icon name="chevron" size={14} /></button>}>
    {close => <>{options.map(option => <MenuItem key={option.value} onClick={async () => { if (!disabled) { await onChange(option.value); close() } }}><span className="column-color-dot" style={{ background: option.color }} /><span className="min-w-0 flex-1 truncate">{option.label}</span>{option.value === value && <Icon name="check" size={14} />}</MenuItem>)}</>}
  </Menu>
}

export function MenuSep() {
  useLanguage()
  return <div className="my-1 h-px bg-black/[0.07] dark:bg-white/[0.08]" />
}

// ---------- 头像 ----------

export function Avatar({ user, size = 28 }: { user: { display_name?: string; username?: string; avatar_color?: string }; size?: number }) {
  useLanguage()
  const name = user.display_name || user.username || '?'
  const initial = [...name][0] ?? '?'
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: user.avatar_color ?? '#7F77DD', fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  )
}

// ---------- 进度条 ----------

export function Progress({ done, total }: { done: number; total: number }) {
  useLanguage()
  if (!total) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
      <div
        className={cx('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-brand-600')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ---------- 日期 ----------

export function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(d)
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—'
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso) ? iso.replace(' ', 'T') + 'Z' : iso
  const date = new Date(normalized)
  return isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

export function dueState(iso?: string): 'none' | 'soon' | 'over' | 'today' {
  if (!iso) return 'none'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  d.setHours(0, 0, 0, 0)
  const diff = (d.getTime() - today.getTime()) / 86400000
  if (diff < 0) return 'over'
  if (diff === 0) return 'today'
  if (diff <= 2) return 'soon'
  return 'none'
}

export function todayISO(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 空状态 ----------

export function Empty({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}><Icon name="empty" size={compact ? 24 : 32} /><p>{text}</p></div>
}

export function Toast({ msg }: { msg: string | null }) {
  useLanguage()
  const presence = usePresence(!!msg)
  const last = useRef(msg)
  if (msg) last.current = msg
  if (!presence.mounted) return null
  return (
    <div className="fixed bottom-5 left-1/2 z-[100] max-w-[calc(100vw-32px)] -translate-x-1/2">
      <div role="status" aria-live="polite" data-motion={presence.phase} className="pop motion-panel rounded-lg bg-[#2C2C2A] px-4 py-2 text-[13px] text-white shadow-lift dark:bg-white dark:text-[#2C2C2A]">{msg || last.current}</div>
    </div>
  )
}
