import React, { useEffect, useRef, useState } from 'react'

export function cx(...v: (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

// ---------- 按钮 ----------

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'soft'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]'
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-800',
    soft: 'bg-black/[0.04] hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]',
    ghost:
      'border border-black/[0.12] hover:bg-black/[0.04] dark:border-white/[0.14] dark:hover:bg-white/[0.08]',
    danger: 'border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800/60 dark:text-red-400 dark:hover:bg-red-950/40',
  }[variant]
  return <button className={cx(base, sizes, variants, className)} {...rest} />
}

// ---------- 输入 ----------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
      className={cx(
        'h-9 w-full rounded-lg border border-black/[0.12] bg-white px-3 text-[13px] outline-none',
        'placeholder:text-black/30 focus:border-brand-400 focus:ring-2 focus:ring-brand-100',
        'dark:border-white/[0.14] dark:bg-white/[0.06] dark:placeholder:text-white/30 dark:focus:ring-brand-800/50',
        props.className,
      )}
    />
    )
  },
)

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        'w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none resize-none',
        'placeholder:text-black/30 focus:border-brand-400 focus:ring-2 focus:ring-brand-100',
        'dark:border-white/[0.14] dark:bg-white/[0.06] dark:placeholder:text-white/30 dark:focus:ring-brand-800/50',
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
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
      <textarea
        ref={ref}
        value={draft}
        rows={multiline ? 3 : 1}
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = e.target.scrollHeight + 'px'
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
          'w-full resize-none rounded-md border border-brand-400 bg-white px-2 py-1 text-[13px] outline-none ring-2 ring-brand-100 dark:bg-white/[0.08]',
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
      title="双击编辑"
    >
      {value || <span className="opacity-40">{placeholder ?? '（空）'}</span>}
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
  okText = '确定',
  onOK,
  onClose,
}: {
  open: boolean
  title: string
  label?: string
  initial?: string
  placeholder?: string
  okText?: string
  onOK: (v: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  if (!open) return null
  const submit = () => {
    const v = draft.trim()
    if (!v) return
    onOK(v)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={title} width={380}>
      {label && <div className="mb-1.5 text-[12px] opacity-65">{label}</div>}
      <Input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={!draft.trim()} onClick={submit}>
          {okText}
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
  okText = '确定',
  onOK,
  onClose,
}: {
  open: boolean
  title: string
  message: React.ReactNode
  danger?: boolean
  okText?: string
  onOK: () => void
  onClose: () => void
}) {
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={title} width={380}>
      <div className="text-[13px] leading-relaxed opacity-80">{message}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => {
            onOK()
            onClose()
          }}
        >
          {okText}
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
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="fade-in absolute inset-0 bg-black/35" onClick={onClose} />
      <div
        className="pop relative w-[calc(100vw-32px)] rounded-xl border border-black/[0.08] bg-white shadow-lift dark:border-white/[0.1] dark:bg-[#232327]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.08]">
          <h3 className="text-[14px] font-medium">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[16px] leading-none opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// ---------- 下拉菜单 ----------

export function Menu({
  trigger,
  children,
  align = 'right',
  width = 200,
}: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className="pop absolute z-40 mt-1 overflow-hidden rounded-lg border border-black/[0.08] bg-white py-1 shadow-lift dark:border-white/[0.1] dark:bg-[#232327]"
          style={{ width, [align]: 0 } as React.CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
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
  return (
    <button
      onClick={onClick}
      className={cx(
        'block w-full px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
        danger ? 'text-red-600 dark:text-red-400' : '',
      )}
    >
      {children}
    </button>
  )
}

export function MenuSep() {
  return <div className="my-1 h-px bg-black/[0.07] dark:bg-white/[0.08]" />
}

// ---------- 头像 ----------

export function Avatar({ user, size = 28 }: { user: { display_name?: string; username?: string; avatar_color?: string }; size?: number }) {
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
  return `${d.getMonth() + 1}月${d.getDate()}日`
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

export function Empty({ text }: { text: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-black/[0.12] px-3 py-8 text-center text-[12px] opacity-50 dark:border-white/[0.14]">
      {text}
    </div>
  )
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="pop fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#2C2C2A] px-4 py-2 text-[13px] text-white shadow-lift dark:bg-white dark:text-[#2C2C2A]">
      {msg}
    </div>
  )
}
