import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { api } from './api'
import { useStore } from './store'
import type { Activity, Attachment, Card, Checklist } from './types'
import { Button, Input, Menu, MenuItem, Progress, cx, dueState, formatDate } from './ui'

const COVERS = ['', '#EEEDFE', '#E1F5EE', '#FAEEDA', '#FBEAF0', '#E6F1FB', '#FCEBEB', '#F1EFE8']

marked.setOptions({ gfm: true, breaks: true })

function renderMarkdown(src: string) {
  try {
    return DOMPurify.sanitize(marked.parse(src) as string)
  } catch {
    return ''
  }
}

export default function CardDrawer() {
  const openId = useStore((s) => s.openCardId)
  const board = useStore((s) => s.board)
  const setOpenCard = useStore((s) => s.setOpenCard)
  const updateCardLocal = useStore((s) => s.updateCardLocal)
  const removeCardLocal = useStore((s) => s.removeCardLocal)
  const reloadBoard = useStore((s) => s.reloadBoard)

  const [card, setCard] = useState<Card | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [desc, setDesc] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [newItem, setNewItem] = useState<Record<number, string>>({})
  const [clAdding, setClAdding] = useState(false)
  const [clTitle, setClTitle] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!openId) {
      setCard(null)
      return
    }
    let alive = true
    api
      .getCard(openId)
      .then((c) => {
        if (!alive) return
        setCard(c)
        setDesc(c.description)
        setEditingDesc(false)
      })
      .catch(() => setOpenCard(null))
    api
      .cardActivities(openId)
      .then((a) => alive && setActs(a))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [openId, setOpenCard])

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenCard(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, setOpenCard])

  const html = useMemo(() => (editingDesc ? '' : renderMarkdown(desc)), [desc, editingDesc])

  if (!openId || !card || !board) return null

  const column = board.columns.find((c) => c.id === card.column_id)
  const total = card.checklists?.reduce((n, c) => n + c.items.length, 0) ?? 0
  const done = card.checklists?.reduce((n, c) => n + c.items.filter((i) => i.done).length, 0) ?? 0

  async function patch(v: Record<string, unknown>, local?: Partial<Card>) {
    const optimistic = { ...card!, ...local }
    setCard(optimistic)
    updateCardLocal(optimistic)
    try {
      const saved = await api.updateCard(card!.id, v)
      setCard((c) => ({ ...c!, ...saved, checklists: c!.checklists, attachments: c!.attachments }))
    } catch {
      void reloadBoard()
    }
  }

  async function saveDesc() {
    setEditingDesc(false)
    await patch({ description: desc }, { description: desc })
  }

  async function toggleLabel(labelId: number, on: boolean) {
    const updated = await api.setCardLabel(card!.id, labelId, on)
    const next = { ...card!, ...updated, checklists: card!.checklists, attachments: card!.attachments }
    setCard(next)
    updateCardLocal(next)
  }

  async function addChecklist(title: string) {
    const cl = await api.createChecklist(card!.id, title.trim())
    setCard({ ...card!, checklists: [...(card!.checklists ?? []), cl] })
  }

  async function addItem(list: Checklist) {
    const text = (newItem[list.id] ?? '').trim()
    if (!text) return
    const it = await api.createItem(list.id, text)
    setCard({
      ...card!,
      checklists: card!.checklists?.map((c) =>
        c.id === list.id ? { ...c, items: [...c.items, it] } : c,
      ),
    })
    setNewItem({ ...newItem, [list.id]: '' })
    void reloadBoard()
  }

  async function toggleItem(itemId: number, done: boolean) {
    setCard({
      ...card!,
      checklists: card!.checklists?.map((c) => ({
        ...c,
        items: c.items.map((i) => (i.id === itemId ? { ...i, done } : i)),
      })),
    })
    await api.updateItem(itemId, { done }).catch(() => {})
    void reloadBoard()
  }

  async function removeItem(id: number) {
    setCard({
      ...card!,
      checklists: card!.checklists?.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) })),
    })
    await api.deleteItem(id).catch(() => {})
    void reloadBoard()
  }

  async function upload(file: File) {
    const att = await api.uploadAttachment(card!.id, file)
    setCard({ ...card!, attachments: [...(card!.attachments ?? []), att] })
  }

  async function removeAttachment(a: Attachment) {
    setCard({ ...card!, attachments: card!.attachments?.filter((x) => x.id !== a.id) })
    await api.deleteAttachment(a.id).catch(() => {})
  }

  const due = dueState(card.due_date)

  return (
    <>
      <div className="fade-in absolute inset-0 z-30 bg-black/25" onClick={() => setOpenCard(null)} />
      <aside className="slide-in absolute inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col border-l border-black/[0.08] bg-white shadow-drawer dark:border-white/[0.1] dark:bg-[#202024]">
        <div className="flex items-center gap-2 border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.08]">
          <span className="rounded bg-black/[0.05] px-2 py-0.5 text-[12px] opacity-70 dark:bg-white/[0.1]">
            {column?.name ?? '未知列表'}
          </span>
          {card.due_date && (
            <span
              className={cx(
                'rounded px-2 py-0.5 text-[12px]',
                due === 'over'
                  ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                  : 'bg-black/[0.05] opacity-80 dark:bg-white/[0.1]',
              )}
            >
              {formatDate(card.due_date)}
            </span>
          )}
          <button
            onClick={() => setOpenCard(null)}
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[17px] leading-none opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            title="关闭 (Esc)"
          >
            ×
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          <textarea
            defaultValue={card.title}
            rows={1}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== card.title) void patch({ title: v }, { title: v })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            className="mb-4 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-medium leading-[1.5] outline-none hover:border-black/[0.1] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:hover:border-white/[0.12]"
            style={{ overflow: 'hidden' }}
            ref={(el) => {
              if (el) {
                el.style.height = 'auto'
                el.style.height = el.scrollHeight + 'px'
              }
            }}
          />

          {/* 标签 */}
          <Section title="标签">
            <div className="flex flex-wrap items-center gap-1.5">
              {board.labels.map((l) => {
                const on = card.labels.some((x) => x.id === l.id)
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id, !on)}
                    className={cx(
                      'rounded-md px-2 py-1 text-[12px] transition-all',
                      on ? 'ring-1 ring-inset' : 'opacity-45 hover:opacity-80',
                    )}
                    style={
                      on
                        ? { background: l.color + '22', color: l.color, boxShadow: `inset 0 0 0 1px ${l.color}` }
                        : { background: l.color + '14', color: l.color }
                    }
                  >
                    {l.name || '未命名'}
                  </button>
                )
              })}
              <Menu
                align="left"
                width={240}
                trigger={(_, toggle) => (
                  <button
                    onClick={toggle}
                    className="rounded-md border border-dashed border-black/[0.2] px-2 py-1 text-[12px] opacity-60 hover:opacity-100 dark:border-white/[0.2]"
                  >
                    ＋ 标签
                  </button>
                )}
              >
                {(close) => (
                  <LabelEditor
                    boardId={board.id}
                    onDone={() => {
                      close()
                      void reloadBoard()
                    }}
                  />
                )}
              </Menu>
            </div>
          </Section>

          {/* 截止日期 / 封面 */}
          <div className="mb-5 grid grid-cols-2 gap-4">
            <Section title="截止日期">
              <Input
                type="date"
                value={card.due_date?.slice(0, 10) ?? ''}
                onChange={(e) => patch({ due_date: e.target.value }, { due_date: e.target.value })}
              />
              {card.due_date && (
                <button
                  onClick={() => patch({ due_date: '' }, { due_date: '' })}
                  className="mt-1.5 text-[12px] opacity-50 hover:opacity-90"
                >
                  清除
                </button>
              )}
            </Section>
            <Section title="封面颜色">
              <div className="flex flex-wrap gap-1.5">
                {COVERS.map((c) => (
                  <button
                    key={c || 'none'}
                    onClick={() => patch({ cover: c }, { cover: c })}
                    className={cx(
                      'h-6 w-6 rounded-md border',
                      card.cover === c
                        ? 'border-brand-600 ring-2 ring-brand-100'
                        : 'border-black/[0.12] dark:border-white/[0.16]',
                    )}
                    style={{ background: c || 'transparent' }}
                    title={c || '无'}
                  />
                ))}
              </div>
            </Section>
          </div>

          {/* 描述 */}
          <Section
            title="描述"
            action={
              <button
                onClick={() => (editingDesc ? saveDesc() : setEditingDesc(true))}
                className="text-[12px] opacity-55 hover:opacity-100"
              >
                {editingDesc ? '保存' : '编辑'}
              </button>
            }
          >
            {editingDesc ? (
              <div>
                <textarea
                  autoFocus
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={8}
                  placeholder="支持 Markdown：**粗体**、`代码`、- 列表、> 引用"
                  className="w-full resize-y rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-brand-400 dark:border-white/[0.14] dark:bg-white/[0.06]"
                />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={saveDesc}>
                    保存
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDesc(card.description)
                      setEditingDesc(false)
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : desc ? (
              <div
                className="markdown-body rounded-lg bg-black/[0.02] px-3 py-2 dark:bg-white/[0.04]"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <button
                onClick={() => setEditingDesc(true)}
                className="w-full rounded-lg border border-dashed border-black/[0.14] px-3 py-4 text-left text-[12.5px] opacity-45 hover:opacity-80 dark:border-white/[0.16]"
              >
                添加更详细的描述…
              </button>
            )}
          </Section>

          {/* 清单 */}
          <Section title={total ? `清单 · ${done}/${total}` : '清单'}>
            {clAdding ? (
              <div className="mb-3 flex items-center gap-2">
                <Input
                  autoFocus
                  value={clTitle}
                  placeholder="清单名称，如：待办事项"
                  onChange={(e) => setClTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && clTitle.trim()) {
                      void addChecklist(clTitle)
                      setClTitle('')
                      setClAdding(false)
                    }
                    if (e.key === 'Escape') setClAdding(false)
                  }}
                  onBlur={() => {
                    if (clTitle.trim()) {
                      void addChecklist(clTitle).catch(() => {})
                      setClTitle('')
                    }
                    setClAdding(false)
                  }}
                  className="h-8"
                />
                <Button size="sm" onClick={() => setClAdding(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setClAdding(true)}
                className="mb-3 text-[12px] opacity-55 hover:opacity-100"
              >
                ＋ 添加清单
              </button>
            )}
            {total > 0 && (
              <div className="mb-3">
                <Progress done={done} total={total} />
              </div>
            )}
            {(card.checklists ?? []).map((cl) => (
              <div key={cl.id} className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12.5px] font-medium">{cl.title}</span>
                  <button
                    onClick={async () => {
                      await api.deleteChecklist(cl.id).catch(() => {})
                      setCard({
                        ...card!,
                        checklists: card!.checklists?.filter((c) => c.id !== cl.id),
                      })
                      void reloadBoard()
                    }}
                    className="text-[11px] opacity-35 hover:opacity-90"
                  >
                    删除
                  </button>
                </div>
                <div className="space-y-0.5">
                  {cl.items.map((it) => (
                    <div key={it.id} className="group flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
                      <input
                        type="checkbox"
                        checked={it.done}
                        onChange={(e) => toggleItem(it.id, e.target.checked)}
                        className="mt-[3px] h-3.5 w-3.5 accent-brand-600"
                      />
                      <span
                        className={cx(
                          'flex-1 break-words text-[13px] leading-[1.5]',
                          it.done && 'opacity-40 line-through',
                        )}
                      >
                        {it.text}
                      </span>
                      <button
                        onClick={() => removeItem(it.id)}
                        className="text-[12px] opacity-0 transition-opacity group-hover:opacity-45 hover:!opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1.5 pl-1">
                  <input
                    value={newItem[cl.id] ?? ''}
                    onChange={(e) => setNewItem({ ...newItem, [cl.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addItem(cl)
                    }}
                    placeholder="添加一项，回车确认"
                    className="h-7 flex-1 rounded-md border border-black/[0.1] bg-transparent px-2 text-[12.5px] outline-none focus:border-brand-400 dark:border-white/[0.14]"
                  />
                </div>
              </div>
            ))}
            {!card.checklists?.length && (
              <p className="text-[12.5px] opacity-40">还没有清单，点右上角添加</p>
            )}
          </Section>

          {/* 附件 */}
          <Section
            title="附件"
            action={
              <button onClick={() => fileRef.current?.click()} className="text-[12px] opacity-55 hover:opacity-100">
                ＋ 上传
              </button>
            }
          >
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
            {(card.attachments ?? []).length === 0 ? (
              <p className="text-[12.5px] opacity-40">还没有附件</p>
            ) : (
              <ul className="space-y-1">
                {card.attachments!.map((a) => (
                  <li key={a.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
                    <a
                      href={a.path}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 truncate text-[12.5px] underline-offset-2 hover:underline"
                    >
                      {a.name}
                    </a>
                    <span className="text-[11px] opacity-40">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                    <button
                      onClick={() => removeAttachment(a)}
                      className="text-[12px] opacity-0 transition-opacity group-hover:opacity-45 hover:!opacity-100"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 活动 */}
          {acts.length > 0 && (
            <Section title="活动">
              <ul className="space-y-1.5">
                {acts.slice(0, 12).map((a) => (
                  <li key={a.id} className="text-[12px] opacity-60">
                    <span className="font-medium">{a.username || '某人'}</span> {activityText(a.type)}{' '}
                    {a.detail && <span className="opacity-70">「{a.detail}」</span>}
                    <span className="ml-1 opacity-50">{new Date(a.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-black/[0.07] px-4 py-3 dark:border-white/[0.08]">
          <Button size="sm" onClick={() => void patch({ archived: true }, { archived: true }).then(() => setOpenCard(null))}>
            归档
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await api.deleteCard(card.id).catch(() => {})
              removeCardLocal(card.id)
              setOpenCard(null)
            }}
          >
            删除卡片
          </Button>
          <span className="ml-auto text-[11px] opacity-35">
            创建于 {new Date(card.created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
      </aside>
    </>
  )
}

function activityText(type: string) {
  return (
    {
      created: '创建了卡片',
      archived: '归档了卡片',
      restored: '恢复了卡片',
      moved: '移动了卡片',
      updated: '更新了卡片',
    }[type] ?? '操作了卡片'
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[12px] font-medium uppercase tracking-wide opacity-45">{title}</h4>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}

function LabelEditor({ boardId, onDone }: { boardId: number; onDone: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#7F77DD')
  const palette = ['#7F77DD', '#1D9E75', '#D85A30', '#378ADD', '#D4537E', '#BA7517', '#639922', '#E24B4A']

  async function create() {
    if (!name.trim()) return
    await api.createLabel(boardId, name.trim(), color).catch(() => {})
    onDone()
  }

  return (
    <div className="px-3 py-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        placeholder="标签名"
        className="mb-2 h-8 w-full rounded-md border border-black/[0.12] bg-transparent px-2 text-[13px] outline-none dark:border-white/[0.14]"
      />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cx('h-5 w-5 rounded', color === c ? 'ring-2 ring-brand-400' : '')}
            style={{ background: c }}
          />
        ))}
      </div>
      <Button size="sm" variant="primary" onClick={create} className="w-full">
        创建标签
      </Button>
    </div>
  )
}
