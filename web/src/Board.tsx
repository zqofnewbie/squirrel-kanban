import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
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

export default function Board() {
  const board = useStore((s) => s.board)!
  const search = useStore((s) => s.search)
  const moveCardLocal = useStore((s) => s.moveCardLocal)
  const updateCardLocal = useStore((s) => s.updateCardLocal)
  const reloadBoard = useStore((s) => s.reloadBoard)
  const setOpenCard = useStore((s) => s.setOpenCard)

  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [activeColumn, setActiveColumn] = useState<number | null>(null)
  const [colMenu, setColMenu] = useState<{ kind: 'clear' | 'delete'; id: number } | null>(null)
  const [addingCol, setAddingCol] = useState(false)
  const [colDraft, setColDraft] = useState('')
  const originColumn = useRef<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const keyword = search.trim().toLowerCase()

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

  function resolveColumnId(id: string | number): number | null {
    if (typeof id === 'string' && id.startsWith('col:')) return Number(id.slice(4))
    const cardId = Number(id)
    for (const col of columns) if (col.cards.some((c) => c.id === cardId)) return col.id
    return null
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as DragData | undefined
    if (data?.type === 'column') {
      setActiveColumn(Number(String(e.active.id).replace('col:', '')))
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
      if (overIndex >= 0) index = overIndex
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
      await api.moveColumn(colId, order[toIdx + 1] ?? 0).catch(() => {})
      await reloadBoard()
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
    const from = originColumn.current
    originColumn.current = null

    try {
      await api.moveCard(cardId, col, beforeId)
      if (from && from !== col) void reloadBoard()
    } catch {
      await reloadBoard()
    }
  }

  // ---------- 操作 ----------

  async function addCard(columnId: number, title: string) {
    try {
      const c = await api.createCard(columnId, title)
      useStore.getState().addCardLocal(c)
    } catch {
      /* 忽略 */
    }
  }

  async function renameCard(id: number, title: string) {
    const prev = columns.flatMap((c) => c.cards).find((c) => c.id === id)
    if (!prev) return
    updateCardLocal({ ...prev, title })
    try {
      await api.updateCard(id, { title })
    } catch {
      void reloadBoard()
    }
  }

  async function renameColumn(id: number, name: string) {
    await api.updateColumn(id, { name }).catch(() => {})
    void reloadBoard()
  }

  async function setWip(id: number, wip_limit: number) {
    await api.updateColumn(id, { wip_limit }).catch(() => {})
    void reloadBoard()
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
      for (const c of col.cards) await api.updateCard(c.id, { archived: true }).catch(() => {})
      void reloadBoard()
    } else {
      if (columns.length <= 1) return
      await api.deleteColumn(col.id).catch(() => {})
      void reloadBoard()
    }
  }

  async function submitColumn() {
    const name = colDraft.trim()
    if (!name) return
    setColDraft('')
    setAddingCol(false)
    await api.createColumn(board.id, name).catch(() => {})
    void reloadBoard()
  }

  const totalCards = columns.reduce((n, c) => n + c.cards.length, 0)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
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
        className="scroll-thin flex h-full gap-3 overflow-x-auto px-4 pb-4 pt-1"
        style={{ alignItems: 'stretch' }}
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
              onOpenCard={setOpenCard}
              onRenameCard={renameCard}
              onAddCard={addCard}
              onRenameColumn={renameColumn}
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
                placeholder="新列表名称，回车创建"
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
                  onClick={submitColumn}
                >
                  创建
                </Button>
                <Button
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setColDraft('')
                    setAddingCol(false)
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCol(true)}
              className="w-full rounded-xl bg-white/60 px-3 py-2 text-left text-[12.5px] opacity-70 shadow-card hover:bg-white hover:opacity-100 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
            >
              ＋ 添加列表
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={colMenu?.kind === 'clear'}
        title="归档全部卡片"
        message={
          colMenu
            ? `把「${columns.find((c) => c.id === colMenu.id)?.name}」下的全部卡片移入归档箱？之后可以在看板菜单的归档箱里恢复。`
            : ''
        }
        okText="归档"
        onOK={doColumnAction}
        onClose={() => setColMenu(null)}
      />
      <ConfirmDialog
        open={colMenu?.kind === 'delete'}
        danger
        title="删除列表"
        message={
          colMenu
            ? (() => {
                const col = columns.find((c) => c.id === colMenu.id)
                return col?.cards.length
                  ? `删除「${col.name}」会一并删除其中 ${col.cards.length} 张卡片，此操作不可恢复。`
                  : `确定删除列表「${col?.name}」？`
              })()
            : ''
        }
        okText="删除"
        onOK={doColumnAction}
        onClose={() => setColMenu(null)}
      />

      {totalCards === 0 && columns.length <= 3 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-8">
          <div className="w-[320px]">
            <Empty text="这个看板还没有卡片，点列表下方的「添加卡片」开始" />
          </div>
        </div>
      )}

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' }}>
        {activeCard ? (
          <div className="w-[270px] rotate-2 rounded-[10px] shadow-lift">
            <CardTile card={activeCard} dimmed={false} onOpen={() => {}} onRename={() => {}} />
          </div>
        ) : activeColumn !== null ? (
          <div className="w-[286px] rounded-xl bg-white/90 px-3 py-2 text-[13px] font-medium shadow-lift dark:bg-[#2A2A2E]/90">
            {columns.find((c) => c.id === activeColumn)?.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export function BoardShell({ children }: { children: React.ReactNode }) {
  return <div className={cx('relative h-full')}>{children}</div>
}
