import { memo, useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card } from './types'
import { cx, dueState, formatDate, Progress } from './ui'

interface Props {
  card: Card
  dimmed: boolean
  onOpen: (id: number) => void
  onRename: (id: number, title: string) => void
}

function CardTileBase({ card, dimmed, onOpen, onRename }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.column_id },
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.title)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [editing])

  function startEdit() {
    setDraft(card.title)
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== card.title) onRename(card.id, v)
  }

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  const due = dueState(card.due_date)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(editing ? {} : listeners)}
      onClick={() => {
        if (!editing) onOpen(card.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
      className={cx(
        'group relative mb-2 cursor-pointer select-none rounded-[10px] border bg-white p-2.5 text-left transition-shadow dark:bg-[#2A2A2E]',
        isDragging
          ? 'z-50 border-brand-400 opacity-95 shadow-lift'
          : 'border-black/[0.06] shadow-card hover:border-black/[0.16] hover:shadow-lift dark:border-white/[0.08] dark:hover:border-white/[0.18]',
        dimmed && 'opacity-25',
      )}
    >
      {card.cover && (
        <div className="mb-2 -mx-2.5 -mt-2.5 h-8 rounded-t-[10px]" style={{ background: card.cover }} />
      )}

      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              className="max-w-full truncate rounded px-1.5 py-[1px] text-[11px] leading-[16px]"
              style={{ background: l.color + '22', color: l.color }}
              title={l.name}
            >
              {l.name || '标签'}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          rows={1}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setDraft(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="w-full resize-none rounded-md border border-brand-400 bg-white px-1.5 py-0.5 text-[13px] leading-[1.55] outline-none ring-2 ring-brand-100 dark:bg-white/[0.08]"
        />
      ) : (
        <div className="break-words text-[13px] leading-[1.55]">{card.title}</div>
      )}

      {(card.checklist_total > 0 || card.due_date || card.attachment_count > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] opacity-70">
          {card.checklist_total > 0 && (
            <span
              className={cx(
                'inline-flex items-center gap-1',
                card.checklist_done === card.checklist_total && 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              <span className="tabular-nums">
                {card.checklist_done}/{card.checklist_total}
              </span>
              <span className="inline-block w-8">
                <Progress done={card.checklist_done} total={card.checklist_total} />
              </span>
            </span>
          )}
          {card.due_date && (
            <span
              className={cx(
                'rounded px-1.5 py-[1px]',
                due === 'over'
                  ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                  : due === 'today'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                    : 'bg-black/[0.05] dark:bg-white/[0.1]',
              )}
            >
              {formatDate(card.due_date)}
            </span>
          )}
          {card.attachment_count > 0 && <span>{card.attachment_count} 个附件</span>}
        </div>
      )}
    </div>
  )
}

export default memo(CardTileBase)
