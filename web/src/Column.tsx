import { Empty } from './ui'
import ColumnScrollFooter from './ColumnScrollFooter'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useContext } from 'react'
import { BoardScale } from './BoardZoom'
import Icon from './Icon'
import { useEffect, useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CardTile from './CardTile'
import VirtualCards from './VirtualCards'
import type { ColumnWithCards } from './types'
import { Button, Menu, MenuItem, MenuSep, Modal, PromptDialog, cx } from './ui'

import { COLOR_PALETTE as COLUMN_COLORS } from './colors'
import type { CardSection } from './store'

interface Props {
  col: ColumnWithCards
  dimmed: Set<number>
  totalCount: number
  filterText?: string
  onOpenCard: (id: number, section?: CardSection) => void
  onRenameCard: (id: number, title: string) => Promise<void>
  onAddCard: (columnId: number, title: string) => Promise<void>
  onRenameColumn: (id: number, name: string) => Promise<void>
  onSetWip: (id: number, limit: number) => Promise<void>
  onSetColor: (id: number, color: string) => Promise<void>
  onClearColumn: (id: number) => void
  onDeleteColumn: (id: number) => void
}

export default function ColumnView({
  col,
  dimmed,
  totalCount,
  filterText = '',
  onOpenCard,
  onRenameCard,
  onAddCard,
  onRenameColumn,
  onSetWip,
  onSetColor,
  onClearColumn,
  onDeleteColumn,
}: Props) {
  useLanguage()
  const scale = useContext(BoardScale)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `col:${col.id}`,
    transition: { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    data: { type: 'column' },
  })
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(col.name)
  const [wipOpen, setWipOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [colorDraft, setColorDraft] = useState(col.color || '#94A3B8')
  const [colorBusy, setColorBusy] = useState(false)
  const [colorError, setColorError] = useState('')
  const colorSaving = useRef(false)
  const [nameError, setNameError] = useState('')
  const [nameBusy, setNameBusy] = useState(false)
  const nameSaving = useRef(false)
  const areaRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { areaRef.current?.scrollTo({ top: 0 }) }, [filterText])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const compose = (event: Event) => { if ((event as CustomEvent<number>).detail === col.id) setComposing(true) }
    window.addEventListener('kanban:compose', compose)
    return () => window.removeEventListener('kanban:compose', compose)
  }, [col.id])
  useEffect(() => {
    if (composing) {
      inputRef.current?.focus()
      // 输入框在列顶，确保它滚进视野
      areaRef.current?.scrollTo({ top: 0 })
    }
  }, [composing])

  async function submit() {
    if (busy) return
    const v = draft.trim()
    if (!v) return
    setBusy(true)
    try {
      await onAddCard(col.id, v)
      setDraft('')
      setComposing(false)
    } catch { /* 保留草稿，错误由全局提示展示 */ }
    finally { setBusy(false) }
  }

  const overLimit = col.wip_limit > 0 && totalCount > col.wip_limit

  function openColors() {
    setColorDraft(col.color || '#94A3B8')
    setColorError('')
    setColorOpen(true)
  }
  async function saveColor(color: string) {
    if (colorSaving.current) return
    colorSaving.current = true; setColorBusy(true); setColorError('')
    try { await onSetColor(col.id, color); setColorOpen(false) }
    catch (e: any) { setColorError(e.message || t("保存失败，请重试")) }
    finally { colorSaving.current = false; setColorBusy(false) }
  }
  async function saveName() {
    if (nameSaving.current) return
    const name = nameDraft.trim()
    if (!name) { setNameError(t("列表名称不能为空")); return }
    if (name === col.name) { setRenaming(false); return }
    nameSaving.current = true; setNameBusy(true); setNameError('')
    try { await onRenameColumn(col.id, name); setRenaming(false) }
    catch (e: any) { setNameError(e.message || t("保存失败，请重试")) }
    finally { nameSaving.current = false; setNameBusy(false) }
  }

  return (
    <div
      ref={setNodeRef}
      data-column-id={col.id}
      style={{ transform: CSS.Translate.toString(transform ? { ...transform, x: transform.x / scale, y: transform.y / scale } : null), transition }}
      className={cx(
        // self-start：列高随内容，添加按钮紧贴最后一张卡片，而不是吊在看板最底部
        'kanban-column flex max-h-full w-[286px] shrink-0 self-start flex-col rounded-xl',
        isDragging && 'column-source-dragging',
      )}
    >
      <div className="column-heading flex shrink-0 items-center gap-2 px-1 pb-2">
        <button className="column-color-trigger" aria-label={t("设置列表颜色：{0}", [col.name])} title={t("设置列表颜色")} onClick={openColors}>
          <span className="column-color-dot" style={{background: col.color || '#94A3B8'}} />
        </button>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              aria-label={t("列表名称")}
              disabled={nameBusy}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setNameDraft(col.name)
                  setNameError('')
                  setRenaming(false)
                }
              }}
              className="w-full rounded-md border border-brand-400 bg-white px-1.5 py-0.5 text-[13px] font-medium outline-none dark:bg-white/[0.08]"
            />
          ) : (
            <button
              {...attributes}
              {...listeners}
              onDoubleClick={() => {
                setNameDraft(col.name)
                setNameError('')
                setRenaming(true)
              }}
              className="inline-flex max-w-full items-center gap-1 cursor-grab rounded-md px-1.5 py-0.5 text-[13px] font-medium hover:bg-black/[0.04] active:cursor-grabbing dark:hover:bg-white/[0.08]"
              title={t("拖动排序 · 双击改名")}
            >
              <Icon name="grip" size={12} className="shrink-0 opacity-40" /><span className="truncate">{col.name}</span>
            </button>
          )}
        </div>
        <span
          className={cx(
            'shrink-0 rounded px-1.5 py-[1px] text-[11px] tabular-nums',
            overLimit
              ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
              : 'bg-black/[0.05] opacity-60 dark:bg-white/[0.1]',
          )}
          title={col.wip_limit > 0 ? t("上限 {0}", [col.wip_limit]) : undefined}
        >
          {col.cards.length !== totalCount ? `${col.cards.length} / ${totalCount}` : totalCount}
          {col.wip_limit > 0 ? ` / ${col.wip_limit}` : ''}
        </span>
        <Menu
          width={180}
          trigger={(_, toggle) => (
            <button
              onClick={toggle}
              aria-label={t("列表菜单：{0}", [col.name])}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[14px] leading-none opacity-40 hover:bg-black/[0.06] hover:opacity-90 dark:hover:bg-white/[0.1]"
            >
              <Icon name="more" size={18} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => { close(); openColors() }}
              >
                {t("设置列表颜色")} </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  setComposing(true)
                }}
              >
                {t("添加卡片")} </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  setNameDraft(col.name)
                  setNameError('')
                  setRenaming(true)
                }}
              >
                {t("重命名列表")} </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  setWipOpen(true)
                }}
              >
                {t("设置上限")} </MenuItem>
              <MenuSep />
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onClearColumn(col.id)
                }}
              >
                {t("归档全部卡片")} </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onDeleteColumn(col.id)
                }}
              >
                {t("删除列表")} </MenuItem>
            </>
          )}
        </Menu>
      </div>
      {nameError && <p role="alert" className="mb-2 text-xs text-red-600">{nameError}</p>}

      {/* 新卡片的输入框固定出现在列顶部——新卡片也插到顶部，创建后立刻可见 */}
      {composing && (
        <div className="mb-2 shrink-0 rounded-lg border border-brand-400 bg-white p-2 shadow-card dark:bg-[#2A2A2E]">
          <textarea
            ref={inputRef}
            disabled={busy}
            aria-label={t("添加卡片到{0}", [col.name])}
            value={draft}
            rows={2}
            placeholder={t("输入标题，回车添加，Shift + Enter 换行")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // isComposing：中文输入法选词的回车不算提交
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                if (!busy) { setDraft(''); setComposing(false) }
              }
            }}
            className="w-full resize-none bg-transparent text-[13px] leading-[1.55] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
          <div className="mt-1 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onMouseDown={(e) => e.preventDefault()}
              disabled={busy || !draft.trim()}
              onClick={() => void submit()}
            >
              {t("添加")} </Button>
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} disabled={busy} onClick={() => { setDraft(''); setComposing(false) }}>
              {t("取消")} </Button>
          </div>
        </div>
      )}

      <div
        ref={areaRef}
        className="column-cards scroll-thin min-h-[24px] shrink overflow-y-auto rounded-xl bg-black/[0.035] p-2 dark:bg-white/[0.045]"
      >
        <SortableContext
          items={col.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {col.cards.length >= 80 ? <VirtualCards cards={col.cards} scrollRef={areaRef} onOpen={onOpenCard} onRename={onRenameCard} /> : col.cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              dimmed={dimmed.has(c.id)}
              onOpen={onOpenCard}
              onRename={onRenameCard}
            />
          ))}
        </SortableContext>
        {col.cards.length === 0 && !composing && (
          <Empty compact text={t("这里还没有卡片")} />
        )}
      </div>

      <ColumnScrollFooter target={areaRef}>
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="add-card-button w-full rounded-lg bg-white/60 px-2 py-1.5 text-left text-[12.5px] opacity-70 shadow-card hover:bg-white hover:opacity-100 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          >
            <Icon name="plus" size={16} />{t("添加卡片")} </button>
        )}
      </ColumnScrollFooter>

      <PromptDialog
        open={wipOpen}
        title={t("设置在制品上限")}
        label={t("「{0}」同时进行的卡片数量上限，0 或留空表示不限制", [col.name])}
        initial={col.wip_limit > 0 ? String(col.wip_limit) : '0'}
        onOK={async (v) => {
          const n = parseInt(v, 10)
          if (isNaN(n) || n < 0) throw new Error(t("请输入大于或等于 0 的整数"))
          await onSetWip(col.id, n)
        }}
        onClose={() => setWipOpen(false)}
      />
      <Modal open={colorOpen} title={t("列表颜色 · {0}", [col.name])} width={300} onClose={() => { if (!colorBusy) setColorOpen(false) }}>
        <p className="mb-3 text-xs text-[var(--muted)]">{t("选择颜色后自动保存，拖动列表不会改变颜色。")}</p>
        <div className="column-color-palette">
          {COLUMN_COLORS.map(([name, color]) => <button key={color} className="color-swatch" disabled={colorBusy} aria-label={t("列表颜色：{0}", [t(name)])} aria-pressed={col.color?.toUpperCase() === color} style={{background: color}} title={t(name)} onClick={() => void saveColor(color)}>
            {col.color?.toUpperCase() === color && <Icon name="check" size={17} />}
          </button>)}
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-[var(--line)] pt-4">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">{t("自定义")}<input type="color" aria-label={t("自定义列表颜色")} disabled={colorBusy} value={colorDraft} onInput={e => setColorDraft(e.currentTarget.value)} onChange={e => setColorDraft(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--line)] bg-transparent p-1" /></label>
          <Button size="sm" variant="primary" disabled={colorBusy} onClick={() => void saveColor(colorDraft)}>{colorBusy ? t("保存中…") : t("保存")}</Button>
        </div>
        {colorError && <p role="alert" className="mt-3 text-xs text-red-600">{colorError}</p>}
      </Modal>
    </div>
  )
}
