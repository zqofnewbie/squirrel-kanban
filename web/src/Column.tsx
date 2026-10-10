import { useEffect, useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CardTile from './CardTile'
import type { ColumnWithCards } from './types'
import { Button, Menu, MenuItem, MenuSep, PromptDialog, cx } from './ui'

interface Props {
  col: ColumnWithCards
  dimmed: Set<number>
  onOpenCard: (id: number) => void
  onRenameCard: (id: number, title: string) => void
  onAddCard: (columnId: number, title: string) => void
  onRenameColumn: (id: number, name: string) => void
  onSetWip: (id: number, limit: number) => void
  onClearColumn: (id: number) => void
  onDeleteColumn: (id: number) => void
}

export default function ColumnView({
  col,
  dimmed,
  onOpenCard,
  onRenameCard,
  onAddCard,
  onRenameColumn,
  onSetWip,
  onClearColumn,
  onDeleteColumn,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `col:${col.id}`,
    data: { type: 'column' },
  })
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(col.name)
  const [wipOpen, setWipOpen] = useState(false)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => setDraft(''), [composing])
  useEffect(() => {
    if (composing) {
      inputRef.current?.focus()
      // 输入框在列顶，确保它滚进视野
      areaRef.current?.scrollTo({ top: 0 })
    }
  }, [composing])

  function submit(keepOpen: boolean) {
    const v = draft.trim()
    if (!v) {
      if (!keepOpen) setComposing(false)
      return
    }
    onAddCard(col.id, v)
    setDraft('')
    if (!keepOpen) setComposing(false)
    else requestAnimationFrame(() => inputRef.current?.focus())
  }

  const overLimit = col.wip_limit > 0 && col.cards.length > col.wip_limit

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(
        // self-start：列高随内容，添加按钮紧贴最后一张卡片，而不是吊在看板最底部
        'flex max-h-full w-[286px] shrink-0 self-start flex-col rounded-xl',
        isDragging && 'opacity-60',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                setRenaming(false)
                const v = nameDraft.trim()
                if (v && v !== col.name) onRenameColumn(col.id, v)
                else setNameDraft(col.name)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setNameDraft(col.name)
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
                setRenaming(true)
              }}
              className="max-w-full cursor-grab truncate rounded-md px-1.5 py-0.5 text-[13px] font-medium hover:bg-black/[0.04] active:cursor-grabbing dark:hover:bg-white/[0.08]"
              title="拖动排序 · 双击改名"
            >
              {col.name}
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
          title={col.wip_limit > 0 ? `上限 ${col.wip_limit}` : undefined}
        >
          {col.cards.length}
          {col.wip_limit > 0 ? ` / ${col.wip_limit}` : ''}
        </span>
        <Menu
          width={180}
          trigger={(_, toggle) => (
            <button
              onClick={toggle}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[14px] leading-none opacity-40 hover:bg-black/[0.06] hover:opacity-90 dark:hover:bg-white/[0.1]"
            >
              ⋯
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close()
                  setComposing(true)
                }}
              >
                添加卡片
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  setNameDraft(col.name)
                  setRenaming(true)
                }}
              >
                重命名列表
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  setWipOpen(true)
                }}
              >
                设置上限
              </MenuItem>
              <MenuSep />
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onClearColumn(col.id)
                }}
              >
                归档全部卡片
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onDeleteColumn(col.id)
                }}
              >
                删除列表
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {/* 新卡片的输入框固定出现在列顶部——新卡片也插到顶部，创建后立刻可见 */}
      {composing && (
        <div className="mb-2 shrink-0 rounded-lg border border-brand-400 bg-white p-2 shadow-card ring-2 ring-brand-100 dark:bg-[#2A2A2E]">
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder="输入标题，回车创建，可连续添加"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // isComposing：中文输入法选词的回车不算提交
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit(true)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setComposing(false)
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setComposing(false)
            }}
            className="w-full resize-none bg-transparent text-[13px] leading-[1.55] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
          <div className="mt-1 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submit(true)}
            >
              添加
            </Button>
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(false)}>
              完成
            </Button>
          </div>
        </div>
      )}

      <div
        ref={areaRef}
        className="scroll-thin min-h-[24px] shrink overflow-y-auto rounded-xl bg-black/[0.035] p-2 dark:bg-white/[0.045]"
      >
        <SortableContext
          items={col.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {col.cards.map((c) => (
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
          <div className="px-1 py-3 text-center text-[12px] opacity-40">这里还没有卡片</div>
        )}
      </div>

      <div className="shrink-0 pt-2">
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="w-full rounded-lg bg-white/60 px-2 py-1.5 text-left text-[12.5px] opacity-70 shadow-card hover:bg-white hover:opacity-100 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          >
            ＋ 添加卡片
          </button>
        )}
      </div>

      <PromptDialog
        open={wipOpen}
        title="设置在制品上限"
        label={`「${col.name}」同时进行的卡片数量上限，0 或留空表示不限制`}
        initial={col.wip_limit > 0 ? String(col.wip_limit) : '0'}
        onOK={(v) => {
          const n = parseInt(v, 10)
          if (!isNaN(n) && n >= 0) onSetWip(col.id, n)
        }}
        onClose={() => setWipOpen(false)}
      />
    </div>
  )
}
