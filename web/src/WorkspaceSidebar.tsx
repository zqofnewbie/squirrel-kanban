import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import SortableBoardRow from './SortableBoardRow'
import { shortcut } from './shortcuts'
import { useLanguage } from './useLanguage'
import { t, preference, savePreference } from './i18n'
import { useRef, useState } from 'react'
import { api } from './api'
import type { Board } from './types'
import { usePresence } from './usePresence'
import Brand from './Brand'
import BoardBadge from './BoardBadge'
import Icon from './Icon'
import { useStore } from './store'
import { cx, PromptDialog, ConfirmDialog } from './ui'

interface Props {
  onToggle: () => void
  collapsed: boolean
  open: boolean
  onClose: () => void
  onCreate: () => void
  onHelp: () => void
}

export default function WorkspaceSidebar({ onToggle, collapsed, open, onClose, onCreate, onHelp }: Props) {
  useLanguage()
  const [draggingBoard, setDraggingBoard] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [sortError, setSortError] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [width, setWidth] = useState(() => Math.max(248, Math.min(400, Number(preference('squirrel.sidebar.width')) || 280)))
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [edit, setEdit] = useState<Board | null>(null)
  const [remove, setRemove] = useState<Board | null>(null)
  const resize = (value: number) => { const next = Math.max(248, Math.min(400, window.innerWidth - 480, value)); setWidth(next); savePreference('squirrel.sidebar.width', String(next)) }
  const me = useStore(s => s.me)
  const workspaceId = useStore(s => s.workspaceId)
  const presence = usePresence(open)
  const page = useStore(s => s.page)
  const setPage = useStore(s => s.setPage)
  const board = useStore(s => s.board)
  const boards = useStore(s => s.boards)
  const openBoard = useStore(s => s.openBoard)
  const setPalette = useStore(s => s.setPalette)
  const setArchiveOpen = useStore(s => s.setArchiveOpen)
  const count = board?.columns.reduce((n, col) => n + col.cards.length, 0) ?? 0

  return (
    <>
      {presence.mounted && <button data-motion={presence.phase} className="sidebar-backdrop fade-in" aria-label={t("关闭导航")} onClick={onClose} />}
      <aside style={{ '--sidebar-width': `${width}px` } as React.CSSProperties} className={cx('workspace-sidebar', open && 'is-open', collapsed && 'is-collapsed')}>
        <Brand animated />
        <button className="sidebar-search" onClick={() => setPalette(true)}>
          <Icon name="search" size={16} /><span>{t("搜索看板与卡片")}</span><kbd>{shortcut('K')}</kbd>
        </button>
        <div className="sidebar-heading">
          {t("我的看板")} <button aria-label={t("新建看板")} disabled={!workspaceId} onClick={onCreate}><Icon name="plus" size={18} /></button>
        </div>
        <DndContext onDragStart={() => setDraggingBoard(true)} onDragCancel={() => setDraggingBoard(false)} sensors={sensors} collisionDetection={closestCenter} onDragEnd={async ({ active, over }) => {
          setDraggingBoard(false)
          if (!over || active.id === over.id || sorting || !workspaceId) return
          const from = boards.findIndex(b => b.id === active.id), to = boards.findIndex(b => b.id === over.id)
          if (from < 0 || to < 0) return
          const ordered = arrayMove(boards, from, to), previous = boards, space = workspaceId
          useStore.setState({ boards: ordered }); setSorting(true); setSortError('')
          try { await api.reorderBoards(space, ordered.map(b => b.id)) } catch { if (useStore.getState().workspaceId === space) useStore.setState({ boards: previous }); setSortError(t("排序保存失败，请重试")) } finally { setSorting(false) }
        }}><SortableContext items={boards.map(b => b.id)} strategy={verticalListSortingStrategy}><nav className={cx("board-navigation scroll-thin", draggingBoard && "is-dragging-boards")} aria-label={t("看板导航")}>
          {boards.map(item => <SortableBoardRow key={item.id} id={item.id} name={item.name} selected={page === 'boards' && item.id === board?.id} disabled={sorting}>
            <button aria-current={page === 'boards' && item.id === board?.id ? 'page' : undefined} className="board-nav-item" title={item.name} onClick={() => { onClose(); void openBoard(item.id) }}>
              <BoardBadge seed={item.id} /><span>{item.name}</span>{!!item.share_count && <span className="board-shared-marker" title={t("已分享")} aria-label={t("已分享")}><Icon name="share" size={12}/></span>}<small>{item.id === board?.id ? count : item.card_count}</small>
            </button>
            <div className="board-nav-actions">
              <button title={t('重命名看板')} aria-label={t('编辑看板：{0}', [item.name])} onClick={() => setEdit(item)}><Icon name="edit" size={14} /></button>
              <button title={t('删除看板')} aria-label={t('删除看板：{0}', [item.name])} onClick={() => setRemove(item)}><Icon name="trash" size={14} /></button>
            </div>
          </SortableBoardRow>)}
        </nav></SortableContext></DndContext>
        {sortError && <p role="alert" className="text-xs text-red-600">{sortError}</p>}
        <button className="sidebar-create" disabled={!workspaceId} onClick={onCreate}><Icon name="plus" size={16} />{t("新建看板")}</button>
        <div className="sidebar-bottom">
          {me && <button className={page === 'administration' ? 'selected' : ''} onClick={() => { setPage('administration'); onClose() }}><Icon name="settings" /><span>{me.role !== 'member' ? t("空间与成员") : t("工作空间")}</span></button>}
          <button className={page === 'shares' ? 'selected' : ''} onClick={() => { setPage('shares'); onClose() }}><Icon name="link" /><span>{t("分享管理")}</span></button>
          <button onClick={() => { setPage('boards'); setArchiveOpen(true); onClose() }}><Icon name="archive" /><span>{t("归档箱")}</span></button>
          <button onClick={onHelp}><Icon name="help" /><span>{t("操作指南")}</span></button>
          <div className="sidebar-note"><span className="status-dot" />{t("轻一点，专注做好每件事")}</div>
        </div>
        <div className="sidebar-resizer" title={t("拖动调整宽度，双击恢复默认")} role="separator" tabIndex={collapsed ? -1 : 0} aria-label={t('调整侧栏宽度')} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={248} aria-valuemax={400}
          onDoubleClick={() => resize(280)}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowLeft' ? -16 : 16)) } else if (event.key === 'Home') { event.preventDefault(); resize(280) } }}
          onPointerDown={event => { event.preventDefault(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); document.documentElement.classList.add('resizing-sidebar') }}
          onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x) }}
          onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); document.documentElement.classList.remove('resizing-sidebar') }}
          onLostPointerCapture={() => { drag.current = null; document.documentElement.classList.remove('resizing-sidebar') }}
        />
      </aside>
      <PromptDialog open={!!edit} title={t('重命名看板')} okText={t('保存')} label={t('看板名称')} initial={edit?.name ?? ''} onClose={() => setEdit(null)} onOK={async name => {
        if (!edit) return
        await api.updateBoard(edit.id, { name })
        useStore.setState(state => ({ boards: state.boards.map(b => b.id === edit.id ? { ...b, name } : b), board: state.board?.id === edit.id ? { ...state.board, name } : state.board }))
      }} />
      <ConfirmDialog open={!!remove} danger title={t('删除看板')} okText={t('删除')} message={t('删除看板「{0}」？其中的列表、卡片、附件都会一并删除，此操作不可恢复。', [remove?.name])} onClose={() => setRemove(null)} onOK={async () => { if (remove) await useStore.getState().removeBoard(remove.id) }} />
    </>
  )
}
