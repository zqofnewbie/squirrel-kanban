import AutoTextarea from './AutoTextarea'
import { focusElement, keyboardFocus } from './focus'
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
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card } from './types'
import {
  cx,
  dueState,
  formatDate,
  Progress,
  Menu,
  MenuItem,
  MenuSep,
  Modal,
  Select,
  ConfirmDialog,
} from './ui'

interface Props {
  card: Card
  dimmed: boolean
  onOpen: (id: number, section?: CardSection) => void
  onRename: (id: number, title: string) => Promise<void>
  shareId?: string
  canEdit?: boolean
  canPin?: boolean
  canMove?: boolean
  onPin?: (id: number, pinned: boolean) => Promise<void>
  moveColumns?: { id: number; name: string; color?: string }[]
  onMove?: (id: number, columnId: number) => Promise<void>
  overlay?: boolean
}

function CardTileBase({
  card,
  dimmed,
  onOpen,
  onRename,
  overlay = false,
  shareId,
  canEdit = true,
  canPin = true,
  canMove = true,
  onPin,
  moveColumns,
  onMove,
  sortable,
}: Props & { sortable?: ReturnType<typeof useSortable> }) {
  useLanguage()
  const scale = useContext(BoardScale)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable ?? {}
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [columns, setColumns] = useState<{ id: number; name: string; color?: string }[]>([])
  const runAction = async (action: () => Promise<void>) => {
    setActionBusy(true)
    setError('')
    try {
      await action()
    } catch (e: any) {
      setError(e.message || t('保存失败，请重试'))
    } finally {
      setActionBusy(false)
    }
  }
  const [pinBusy, setPinBusy] = useState(false)
  async function togglePin() {
    setPinBusy(true)
    setError('')
    try {
      if (onPin) await onPin(card.id, !card.pinned)
      else
        useStore.getState().updateCardLocal(await api.updateCard(card.id, { pinned: !card.pinned }))
    } catch (e: any) {
      setError(e.message || t('保存失败，请重试'))
    } finally {
      setPinBusy(false)
    }
  }
  const tileRef = useRef<HTMLDivElement | null>(null)
  const attachTile = useCallback(
    (node: HTMLDivElement | null) => {
      tileRef.current = node
      setNodeRef?.(node)
    },
    [setNodeRef],
  )
  const editKeyboard = useRef(false)
  const returnFocus = useRef(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      // An async save must not steal focus from another control the user chose.
      if (
        document.activeElement === document.body ||
        tileRef.current?.contains(document.activeElement)
      ) {
        focusElement(
          tileRef.current?.querySelector<HTMLElement>('.card-edit') ?? tileRef.current,
          editKeyboard.current,
        )
      }
    }
  }, [editing])
  const [draft, setDraft] = useState(card.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  function startEdit() {
    editKeyboard.current = keyboardFocus()
    returnFocus.current = false
    setDraft(card.title)
    setError('')
    setEditing(true)
  }
  async function commit(restore = false) {
    if (savingRef.current) return
    const v = draft.trim()
    if (!v) {
      setError(t('标题不能为空'))
      return
    }
    if (v === card.title) {
      returnFocus.current = restore
      setEditing(false)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await onRename(card.id, v)
      returnFocus.current = restore
      setEditing(false)
    } catch (e: any) {
      setError(e.message || t('保存失败，请重试'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(
      transform ? { ...transform, x: transform.x / scale, y: transform.y / scale } : null,
    ),
    transition,
  }
  const due = dueState(card.due_date)

  return (
    <div
      ref={attachTile}
      style={style}
      {...attributes}
      aria-disabled={false}
      aria-roledescription={canMove ? attributes?.['aria-roledescription'] : undefined}
      {...(editing || !canMove ? {} : listeners)}
      onClick={() => {
        if (!editing) onOpen(card.id)
      }}
      onKeyDown={(e) => {
        if (!editing && !overlay && e.key === 'Enter') {
          e.preventDefault()
          onOpen(card.id)
          return
        }
        if (!editing && !overlay && !canMove && e.key === ' ') {
          e.preventDefault()
          onOpen(card.id)
          return
        }
        if (!editing && !overlay && canMove) listeners?.onKeyDown?.(e)
      }}
      aria-label={card.title}
      className={cx(
        'card-tile group relative mb-2 cursor-pointer select-none rounded-[10px] border bg-white p-2.5 text-left transition-shadow dark:bg-[#2A2A2E]',
        isDragging ? 'z-50 opacity-95' : 'border-black/[0.06] dark:border-white/[0.08]',
        dimmed && 'opacity-25',
        card.cover && 'has-cover',
        isDragging && 'is-dragging',
      )}
    >
      {card.pinned && (
        <div className="card-pin-label">
          <Icon name="pin" size={12} />
          {t('已固定')}
        </div>
      )}
      {!editing && error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {card.cover && <div className="card-cover" style={{ background: card.cover }} />}

      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              className="colored-label max-w-full truncate rounded px-1.5 py-[1px] text-[11px] leading-[16px]"
              style={
                { background: l.color + '22', '--label-color': l.color } as React.CSSProperties
              }
              title={l.name}
            >
              {l.name || t('标签')}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <AutoTextarea
          ref={ref}
          maxCharacters={250}
          aria-label={t('编辑卡片标题')}
          disabled={saving}
          value={draft}
          rows={1}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              void commit(true)
            }
            if (e.key === 'Escape' && !saving && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              returnFocus.current = true
              setEditing(false)
            }
          }}
          className="w-full resize-none overflow-hidden rounded-md border border-brand-400 bg-white px-1.5 py-0.5 text-[13px] leading-[1.55] outline-none dark:bg-white/[0.08]"
        />
      ) : (
        <div className="card-title-row">
          <div className="card-title break-words text-[13px] leading-[1.55]">{card.title}</div>
          {
            <div
              className="card-actions"
              aria-hidden={overlay || undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {!overlay && (
                <Menu
                  openOnHover
                  placement="right-start"
                  width={210}
                  trigger={(open, toggle) => (
                    <button
                      type="button"
                      className="card-more"
                      disabled={actionBusy || pinBusy}
                      aria-label={t('卡片操作')}
                      onClick={toggle}
                    >
                      <span style={{ display: 'flex', transform: 'rotate(90deg)' }}>
                        <Icon name="more" size={16} />
                      </span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {canPin && (
                        <MenuItem
                          onClick={() => {
                            close()
                            if (!pinBusy) void togglePin()
                          }}
                        >
                          <Icon name="pin" size={16} />
                          {t(card.pinned ? '取消固定' : '固定到列表顶部')}
                        </MenuItem>
                      )}
                      {canEdit && (
                        <MenuItem
                          onClick={() => {
                            close()
                            startEdit()
                          }}
                        >
                          <Icon name="edit" size={16} />
                          {t('编辑标题')}
                        </MenuItem>
                      )}
                      <MenuItem
                        onClick={() => {
                          close()
                          onOpen(card.id)
                        }}
                      >
                        <Icon name="description" size={16} />
                        {t('卡片详情')}
                      </MenuItem>
                      {canMove && (
                        <MenuItem
                          onClick={() => {
                            close()
                            setColumns(moveColumns ?? useStore.getState().board?.columns ?? [])
                            setMoveOpen(true)
                          }}
                        >
                          <Icon name="external" size={16} />
                          {t('移动卡片')}
                        </MenuItem>
                      )}
                      <MenuItem
                        onClick={() => {
                          close()
                          onOpen(card.id, 'comments')
                        }}
                      >
                        <Icon name="comment" size={16} />
                        {t('评论')}
                      </MenuItem>
                      {!!card.attachment_count && (
                        <MenuItem
                          onClick={() => {
                            close()
                            onOpen(card.id, 'attachments')
                          }}
                        >
                          <Icon name="attachment" size={16} />
                          {t('附件')}
                        </MenuItem>
                      )}
                      {!shareId && (
                        <>
                          <MenuSep />
                          <MenuItem
                            onClick={() => {
                              close()
                              void runAction(async () => {
                                useStore
                                  .getState()
                                  .updateCardLocal(
                                    await api.updateCard(card.id, { archived: true }),
                                  )
                              })
                            }}
                          >
                            <Icon name="archive" size={16} />
                            {t('归档')}
                          </MenuItem>
                          <MenuItem
                            danger
                            onClick={() => {
                              close()
                              setDeleteOpen(true)
                            }}
                          >
                            <Icon name="trash" size={16} />
                            {t('删除卡片')}
                          </MenuItem>
                        </>
                      )}
                    </>
                  )}
                </Menu>
              )}
            </div>
          }
        </div>
      )}

      {!overlay && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Modal open={moveOpen} title={t('移动卡片')} onClose={() => setMoveOpen(false)}>
            <Select
              fullWidth
              label={t('移动到列表')}
              value={card.column_id}
              disabled={actionBusy}
              options={columns.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
              onChange={(columnId) =>
                runAction(async () => {
                  if (onMove) await onMove(card.id, columnId)
                  else {
                    await api.moveCard(card.id, columnId, 0)
                    await useStore.getState().reloadBoard()
                  }
                  setMoveOpen(false)
                })
              }
            />
          </Modal>
          <ConfirmDialog
            open={deleteOpen}
            danger
            title={t('删除卡片')}
            okText={t('删除卡片')}
            message={t('删除「{0}」及其清单、评论、附件？此操作不可恢复。', [card.title])}
            onClose={() => setDeleteOpen(false)}
            onOK={async () => {
              await api.deleteCard(card.id)
              useStore.getState().removeCardLocal(card.id)
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      {!editing && card.description.trim() && (
        <p className="card-description">
          {card.description
            .replace(/!?(\[[^\]]*\])\([^)]*\)/g, '$1')
            .replace(/[#*`_>\[\]]/g, '')
            .trim()}
        </p>
      )}
      {(card.checklist_total > 0 ||
        card.due_date ||
        card.attachment_count > 0 ||
        card.comment_count > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
          {card.checklist_total > 0 && (
            <span
              title={t('清单：{0}/{1} 已完成', [card.checklist_done, card.checklist_total])}
              className={cx(
                'inline-flex items-center gap-1',
                card.checklist_done === card.checklist_total &&
                  'text-emerald-600 dark:text-emerald-400',
              )}
            >
              <Icon name="checklist" size={13} />
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
                'inline-flex items-center gap-1 rounded px-1.5 py-[1px]',
                due === 'over'
                  ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                  : due === 'today'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                    : 'bg-black/[0.05] dark:bg-white/[0.1]',
              )}
            >
              <Icon name="calendar" size={13} />
              {formatDate(card.due_date)}
            </span>
          )}
          {card.attachment_count > 0 && (
            <CardPeek shareId={shareId} card={card} kind="attachments" onOpen={onOpen} />
          )}
          {card.comment_count > 0 && (
            <CardPeek shareId={shareId} card={card} kind="comments" onOpen={onOpen} />
          )}
        </div>
      )}
    </div>
  )
}

function SortableCard(props: Props) {
  const sortable = useSortable({
    id: props.card.id,
    data: { type: 'card', columnId: props.card.column_id, pinned: !!props.card.pinned },
    disabled: props.canMove === false,
    transition: cardTransition,
  })
  return <CardTileBase {...props} sortable={sortable} />
}
function CardTile(props: Props) {
  return props.overlay ? <CardTileBase {...props} /> : <SortableCard {...props} />
}
export default memo(CardTile)
