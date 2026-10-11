import { boardCollision, cardDropAnimation } from './boardDrag'
import ColumnDragPreview, { captureColumn } from './ColumnDragPreview'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import Icon from './Icon'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  defaultDropAnimationSideEffects,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import ColumnView from './Column'
import CardTile from './CardTile'
import { api } from './api'
import { useStore } from './store'
import type { Card } from './types'
import { Button, ConfirmDialog, Empty, cx } from './ui'

type DragData = { type: 'card' | 'column'; columnId?: number }

export default function Board({ zoom = 1, height }: { zoom?: number; height?: number }) {
  useLanguage()
  const board = useStore((s) => s.board)!
  const search = useStore((s) => s.search)
  const moveCardLocal = useStore((s) => s.moveCardLocal)
  const updateCardLocal = useStore((s) => s.updateCardLocal)
  const reloadBoard = useStore((s) => s.reloadBoard)
  const setOpenCard = useStore((s) => s.setOpenCard)

  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [columnSnapshot, setColumnSnapshot] = useState<ReturnType<typeof captureColumn> | null>(null)
  const [activeColumn, setActiveColumn] = useState<number | null>(null)
  const [colMenu, setColMenu] = useState<{ kind: 'clear' | 'delete'; id: number } | null>(null)
  const [addingCol, setAddingCol] = useState(false)
  const [savingColumn, setSavingColumn] = useState(false)
  const [colDraft, setColDraft] = useState('')
  const [dragWidth, setDragWidth] = useState(266)
  const originColumn = useRef<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const keyword = useDeferredValue(search.trim().toLowerCase())

  // 搜索命中的卡片 id 集合（为空表示不筛选）
  const dimmed = useMemo(() => {
    const set = new Set<number>()
    if (!keyword) return set
    board.columns.forEach((col) =>
      col.cards.forEach((c) => {
        const hay = (c.title + ' ' + c.description + ' ' + c.labels.map((l) => l.name).join(' ')).toLowerCase()
        if (!hay.includes(keyword)) set.add(c.id)
      }),
    )
    return set
  }, [board, keyword])

  const columns = board.columns

  const cardColumns = useMemo(() => new Map(columns.flatMap(col => col.cards.map(card => [card.id, col.id] as const))), [columns])

  function resolveColumnId(id: string | number): number | null {
    if (typeof id === 'string' && id.startsWith('col:')) return Number(id.slice(4))
    const cardId = Number(id)
    return cardColumns.get(cardId) ?? null
  }

  // Resolve a column first, then its cards: parent columns must not compete
  // with their own children as equally ranked drop targets.
  const collisionDetection = boardCollision

  function onDragStart(e: DragStartEvent) {
    const rect = e.active.rect.current.initial
    if (rect) setDragWidth(rect.width / zoom)
    const data = e.active.data.current as DragData | undefined
    if (data?.type === 'column') {
      const id = Number(String(e.active.id).replace('col:', ''))
      const element = document.querySelector<HTMLElement>(`[data-column-id="${id}"]`)
      setColumnSnapshot(element ? captureColumn(element, zoom) : null)
      setActiveColumn(id)
      return
    }
    const id = Number(e.active.id)
    for (const col of columns) {
      const c = col.cards.find((x) => x.id === id)
      if (c) {
        setActiveCard(c)
        originColumn.current = col.id
        return
      }
    }
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const data = active.data.current as DragData | undefined
    if (data?.type !== 'card') return

    const activeId = Number(active.id)
    const from = resolveColumnId(activeId)
    const to = resolveColumnId(over.id)
    if (!from || !to || from === to) return

    const target = columns.find((c) => c.id === to)
    if (!target) return
    let index = target.cards.length
    if (typeof over.id === 'number') {
      const overIndex = target.cards.findIndex((c) => c.id === over.id)
      if (overIndex >= 0) {
        const translated = active.rect.current.translated
        const below = translated && translated.top > over.rect.top + over.rect.height / 2
        index = overIndex + (below ? 1 : 0)
      }
    }
    moveCardLocal(activeId, to, index)
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveCard(null)
    setActiveColumn(null)
    const data = active.data.current as DragData | undefined

    // 列排序：算出新顺序后，只把「后一列」告诉服务端
    if (data?.type === 'column') {
      const colId = Number(String(active.id).replace('col:', ''))
      const fromIdx = columns.findIndex((c) => c.id === colId)
      if (fromIdx < 0) return
      let toIdx = fromIdx
      if (over) {
        const overCol = resolveColumnId(over.id)
        if (overCol) {
          const i = columns.findIndex((c) => c.id === overCol)
          if (i >= 0) toIdx = i
        }
      }
      if (toIdx === fromIdx) return
      const order = columns.map((c) => c.id).filter((id) => id !== colId)
      order.splice(toIdx, 0, colId)
      useStore.setState(s => s.board?.id === board.id ? { board: { ...s.board, columns: order.map(id => s.board!.columns.find(c => c.id === id)!) } } : {})
      try { await api.moveColumn(colId, order[toIdx + 1] ?? 0) } catch { await reloadBoard() }
      return
    }

    if (!over) {
      await reloadBoard()
      return
    }
    const cardId = Number(active.id)
    const col = resolveColumnId(cardId)
    if (!col) {
      await reloadBoard()
      return
    }
    const target = columns.find((c) => c.id === col)
    if (!target) return

    let index = target.cards.findIndex((c) => c.id === cardId)
    if (index < 0) index = target.cards.length

    // 同列内排序：按落点重新排
    const overCol = resolveColumnId(over.id)
    if (overCol === col && typeof over.id === 'number' && over.id !== cardId) {
      const overIndex = target.cards.findIndex((c) => c.id === over.id)
      if (overIndex >= 0) {
        const removed = target.cards.filter((c) => c.id !== cardId)
        removed.splice(overIndex, 0, target.cards[index])
        moveCardLocal(cardId, col, removed.findIndex((c) => c.id === cardId))
      }
    }

    const finalList = useStore.getState().board?.columns.find((c) => c.id === col)?.cards ?? []
    const finalIdx = finalList.findIndex((c) => c.id === cardId)
    const beforeId = finalIdx >= 0 && finalIdx + 1 < finalList.length ? finalList[finalIdx + 1].id : 0
    originColumn.current = null

    try {
      const saved = await api.moveCard(cardId, col, beforeId)
      if (useStore.getState().board?.id === board.id) updateCardLocal(saved)
    } catch {
      await reloadBoard()
    }
  }

  // ---------- 操作 ----------

  async function addCard(columnId: number, title: string) {
    const c = await api.createCard(columnId, title)
    useStore.getState().addCardLocal(c)
  }

  async function renameCard(id: number, title: string) {
    const fresh=await api.updateCard(id,{title})
    updateCardLocal(fresh)
  }

  async function renameColumn(id: number, name: string) {
    await api.updateColumn(id, { name })
    await reloadBoard()
  }

  async function setWip(id: number, wip_limit: number) {
    await api.updateColumn(id, { wip_limit })
    await reloadBoard()
  }

  async function setColumnColor(id: number, color: string) {
    const saved = await api.updateColumn(id, { color })
    useStore.setState(s => s.board?.id === board.id ? { board: { ...s.board, columns: s.board.columns.map(col => col.id === id ? { ...col, ...saved } : col) } } : {})
  }

  async function clearColumn(id: number) {
    const col = columns.find((c) => c.id === id)
    if (!col) return
    setColMenu({ kind: 'clear', id })
  }

  async function deleteColumn(id: number) {
    if (columns.length <= 1) return
    setColMenu({ kind: 'delete', id })
  }

  async function doColumnAction() {
    if (!colMenu) return
    const col = columns.find((c) => c.id === colMenu.id)
    if (!col) return
    if (colMenu.kind === 'clear') {
      await api.archiveColumn(col.id)
      await reloadBoard()
    } else {
      if (columns.length <= 1) return
      await api.deleteColumn(col.id)
      void reloadBoard()
    }
  }

  async function submitColumn() {
    const name = colDraft.trim()
    if (!name || savingColumn) return
    setSavingColumn(true)
    try {
      await api.createColumn(board.id, name)
      setColDraft('')
      setAddingCol(false)
      await reloadBoard()
    } catch {} finally { setSavingColumn(false) }
  }

  const totalCards = columns.reduce((n, c) => n + c.cards.length, 0)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveCard(null)
        setActiveColumn(null)
        originColumn.current = null
        void reloadBoard()
      }}
    >
      <div
        className="kanban-columns flex gap-3"
        style={{ alignItems: 'stretch', height: height ?? '100%' }}
      >
        <SortableContext
          items={columns.map((c) => `col:${c.id}`)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((col) => (
            <ColumnView
              key={col.id}
              col={keyword ? { ...col, cards: col.cards.filter((c) => !dimmed.has(c.id)) } : col}
              dimmed={dimmed}
              totalCount={col.cards.length}
              filterText={keyword}
              onOpenCard={setOpenCard}
              onRenameCard={renameCard}
              onAddCard={addCard}
              onRenameColumn={renameColumn}
              onSetColor={setColumnColor}
              onSetWip={setWip}
              onClearColumn={clearColumn}
              onDeleteColumn={deleteColumn}
            />
          ))}
        </SortableContext>

        <div className="w-[220px] shrink-0">
          {addingCol ? (
            <div className="rounded-xl bg-white p-2 shadow-card dark:bg-[#2A2A2E]">
              <input
                autoFocus
                value={colDraft}
                disabled={savingColumn}
                aria-label={t("新列表名称")}
                placeholder={t("新列表名称，回车创建")}
                onChange={(e) => setColDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitColumn()
                  if (e.key === 'Escape') {
                    setColDraft('')
                    setAddingCol(false)
                  }
                }}
                onBlur={() => {
                  if (!colDraft.trim()) setAddingCol(false)
                }}
                className="w-full rounded-md bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
              />
              <div className="mt-1.5 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={savingColumn || !colDraft.trim()}
                  onClick={submitColumn}
                >
                  {t("创建")} </Button>
                <Button
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setColDraft('')
                    setAddingCol(false)
                  }}
                >
                  {t("取消")} </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCol(true)}
              className="add-column-button w-full rounded-xl bg-white/60 px-3 py-2 text-left text-[12.5px] opacity-70 shadow-card hover:bg-white hover:opacity-100 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
            >
              <Icon name="plus" size={16} />{t("添加列表")} </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={colMenu?.kind === 'clear'}
        title={t("归档全部卡片")}
        message={
          colMenu
            ? t("把「{0}」下的全部卡片移入归档箱？之后可以在看板菜单的归档箱里恢复。", [columns.find((c) => c.id === colMenu.id)?.name])
            : ''
        }
        okText={t("归档")}
        onOK={doColumnAction}
        onClose={() => setColMenu(null)}
      />
      <ConfirmDialog
        open={colMenu?.kind === 'delete'}
        danger
        title={t("删除列表")}
        message={
          colMenu
            ? (() => {
                const col = columns.find((c) => c.id === colMenu.id)
                return col?.cards.length
                  ? t("删除「{0}」会一并删除其中 {1} 张卡片，此操作不可恢复。", [col.name, col.cards.length])
                  : t("确定删除列表「{0}」？", [col?.name])
              })()
            : ''
        }
        okText={t("删除")}
        onOK={doColumnAction}
        onClose={() => setColMenu(null)}
      />

      {totalCards === 0 && columns.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-8">
          <div className="w-[320px]">
            <Empty text={t("先添加一个列表，再开始创建卡片")} />
          </div>
        </div>
      )}

      {createPortal(<DragOverlay adjustScale={false} dropAnimation={cardDropAnimation}>
        {activeCard ? (
          <div className="card-drag-preview rounded-[10px]" style={{ zoom, width: dragWidth }}>
            <CardTile overlay card={activeCard} dimmed={false} onOpen={() => {}} onRename={async () => {}} />
          </div>
        ) : activeColumn !== null && columnSnapshot ? (
          <ColumnDragPreview snapshot={columnSnapshot} zoom={zoom} />
        ) : null}
      </DragOverlay>, document.body)}
    </DndContext>
  )
}

export function BoardShell({ children }: { children: React.ReactNode }) {
  useLanguage()
  return <div className={cx('relative h-full')}>{children}</div>
}
