import { cardTransition } from './boardDrag'
import { api } from './api'
import { useStore } from './store'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useContext } from 'react'
import { BoardScale } from './BoardZoom'
import CardPeek from './CardPeek'
import type { CardSection } from './store'
import Icon from './Icon'
import { memo, useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card } from './types'
import { cx, dueState, formatDate, Progress } from './ui'

interface Props {
  card: Card
  dimmed: boolean
  onOpen: (id: number, section?: CardSection) => void
  onRename: (id: number, title: string) => Promise<void>
  shareId?: string
  canEdit?: boolean
  canPin?: boolean
  canMove?: boolean
  onPin?: (id:number, pinned:boolean) => Promise<void>
  overlay?: boolean
}

function CardTileBase({ card, dimmed, onOpen, onRename, overlay = false, shareId, canEdit = true, canPin = true, canMove = true, onPin, sortable }: Props & { sortable?: ReturnType<typeof useSortable> }) {
  useLanguage()
  const scale = useContext(BoardScale)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable ?? {}
  const [pinBusy, setPinBusy] = useState(false)
  async function togglePin() {
    setPinBusy(true); setError('')
    try { if(onPin) await onPin(card.id,!card.pinned); else useStore.getState().updateCardLocal(await api.updateCard(card.id, { pinned: !card.pinned })) }
    catch (e: any) { setError(e.message || t("保存失败，请重试")) }
    finally { setPinBusy(false) }
  }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.title)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const savingRef=useRef(false)
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
    setError('');setEditing(true)
  }
  async function commit() {
    if(savingRef.current)return
    const v=draft.trim()
    if(!v){setError(t("标题不能为空"));return}
    if(v===card.title){setEditing(false);return}
    savingRef.current=true;setSaving(true);setError('')
    try {await onRename(card.id,v);setEditing(false)}catch(e:any){setError(e.message||t("保存失败，请重试"))}finally{savingRef.current=false;setSaving(false)}
  }

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: transform.x / scale, y: transform.y / scale } : null),
    transition,
  }
  const due = dueState(card.due_date)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      aria-disabled={false}
      aria-roledescription={canMove ? attributes?.['aria-roledescription'] : undefined}
      {...(editing || !canMove ? {} : listeners)}
      onClick={() => {
        if (!editing) onOpen(card.id)
      }}
      onKeyDown={e => {
        if (!editing && !overlay && e.key === 'Enter') { e.preventDefault(); onOpen(card.id); return }
        if (!editing && !overlay && !canMove && e.key === ' ') { e.preventDefault(); onOpen(card.id); return }
        if (!editing && !overlay && canMove) listeners?.onKeyDown?.(e)
      }}
      aria-label={card.title}
      className={cx(
        'card-tile group relative mb-2 cursor-pointer select-none rounded-[10px] border bg-white p-2.5 text-left transition-shadow dark:bg-[#2A2A2E]',
        isDragging
          ? 'z-50 opacity-95'
          : 'border-black/[0.06] dark:border-white/[0.08]',
        dimmed && 'opacity-25',
        card.cover && 'has-cover',
        isDragging && 'is-dragging',
      )}
    >
      {!editing && !overlay && canEdit && <button className="card-edit" aria-label={t("编辑标题：{0}", [card.title])} title={t("编辑标题")} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); startEdit() }}><Icon name="edit" size={15} /></button>}
      {!editing && !overlay && canPin && <button className={`card-pin ${card.pinned ? 'is-pinned' : ''}`} aria-label={t(card.pinned ? "取消固定" : "固定到列表顶部")} title={t(card.pinned ? "取消固定" : "固定到列表顶部")} aria-pressed={!!card.pinned} disabled={pinBusy} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); void togglePin() }}><Icon name="pin" size={14} /></button>}
      {card.pinned && <div className="card-pin-label"><Icon name="pin" size={12} />{t("已固定")}</div>}
      {!editing && error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {card.cover && (
        <div className="card-cover" style={{ background: card.cover }} />
      )}

      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              className="colored-label max-w-full truncate rounded px-1.5 py-[1px] text-[11px] leading-[16px]"
              style={{ background: l.color + '22', '--label-color': l.color } as React.CSSProperties}
              title={l.name}
            >
              {l.name || t("标签")}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <textarea
          ref={ref}
          aria-label={t("编辑卡片标题")}
          disabled={saving}
          value={draft}
          rows={1}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setDraft(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onBlur={()=>void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void commit()
            }
            if (e.key === 'Escape' && !saving) {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="w-full resize-none rounded-md border border-brand-400 bg-white px-1.5 py-0.5 text-[13px] leading-[1.55] outline-none dark:bg-white/[0.08]"
        />
      ) : (
        <div className="card-title break-words text-[13px] leading-[1.55]">{card.title}</div>
      )}

      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      {!editing && card.description.trim() && <p className="card-description">{card.description.replace(/!?(\[[^\]]*\])\([^)]*\)/g,'$1').replace(/[#*`_>\[\]]/g,'').trim()}</p>}
      {(card.checklist_total > 0 || card.due_date || card.attachment_count > 0 || card.comment_count > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
          {card.checklist_total > 0 && (
            <span title={t("清单：{0}/{1} 已完成", [card.checklist_done, card.checklist_total])}
              className={cx(
                'inline-flex items-center gap-1',
                card.checklist_done === card.checklist_total && 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              <Icon name="checklist" size={13} /><span className="tabular-nums">
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
                'inline-flex items-center gap-1 rounded px-1.5 py-[1px]',
                due === 'over'
                  ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                  : due === 'today'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                    : 'bg-black/[0.05] dark:bg-white/[0.1]',
              )}
            >
              <Icon name="calendar" size={13}/>{formatDate(card.due_date)}
            </span>
          )}
          {card.attachment_count > 0 && <CardPeek shareId={shareId} card={card} kind="attachments" onOpen={onOpen} />}
          {card.comment_count > 0 && <CardPeek shareId={shareId} card={card} kind="comments" onOpen={onOpen} />}
        </div>
      )}
    </div>
  )
}

function SortableCard(props: Props) {
  const sortable = useSortable({ id: props.card.id, data: { type: 'card', columnId: props.card.column_id }, disabled: props.canMove === false, transition: cardTransition })
  return <CardTileBase {...props} sortable={sortable} />
}
function CardTile(props: Props) {
  return props.overlay ? <CardTileBase {...props} /> : <SortableCard {...props} />
}
export default memo(CardTile)
