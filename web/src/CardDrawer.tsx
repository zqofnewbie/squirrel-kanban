import AutoTextarea from './AutoTextarea'
import { Empty } from './ui'
import { CardColumnSelect, CardCoverPicker, renderCardMarkdown } from './CardDetailControls'
import { useLanguage } from './useLanguage'
import { locale } from './i18n'
import { t } from './i18n'
import { usePresence } from './usePresence'
import AttachmentList from './Attachments'
import { COLOR_PALETTE } from './colors'
import Icon from './Icon'
import { createPortal } from 'react-dom'
import CardComments from './CardComments'
import { useDialogFocus } from './useDialogFocus'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { Activity, Card, Checklist, Label } from './types'
import { Button, ConfirmDialog, Input, Menu, MenuItem, Modal, cx, dueState, formatDate } from './ui'

export default function CardDrawer() {
  useLanguage()
  const openId = useStore((s) => s.openCardId)
  const presence = usePresence(!!openId)
  const openSection = useStore(s => s.openCardSection)
  const board = useStore((s) => s.board)
  const setOpenCard = useStore((s) => s.setOpenCard)
  const updateCardLocal = useStore((s) => s.updateCardLocal)
  const removeCardLocal = useStore((s) => s.removeCardLocal)
  const reloadBoard = useStore((s) => s.reloadBoard)

  const [card, setCard] = useState<Card | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [dueDraft,setDueDraft]=useState('')
  const attachmentsRef = useRef<HTMLDivElement>(null)
  const commentsRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const currentId = useRef(openId)
  currentId.current = openId
  const [failure, setFailure] = useState('')
  const [retry, setRetry] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deletion, setDeletion] = useState<{ kind: 'item' | 'checklist' | 'attachment'; id: number; name: string } | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [desc, setDesc] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [newItem, setNewItem] = useState<Record<number, string>>({})
  const [clAdding, setClAdding] = useState(false)
  const [clTitle, setClTitle] = useState('')
  const [editingChecklist, setEditingChecklist] = useState<{ id: number; title: string } | null>(null)
  const [editingItem, setEditingItem] = useState<{ id: number; text: string; original: string } | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  useDialogFocus(panelRef, !!openId, () => requestClose())
  const fileRef = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!openId) {
      return
    }
    setCard(null)
    setFailure('')
    setBusy(false)
    setDeleteOpen(false)
    setDeletion(null)
    setActs([])
    setNewItem({})
    setClAdding(false)
    setClTitle('')
    setEditingChecklist(null)
    setEditingItem(null)
    let alive = true
    api
      .getCard(openId)
      .then((c) => {
        if (!alive) return
        setCard(c)
        setTitleDraft(c.title)
        setDueDraft(c.due_date?.slice(0,10) ?? '')
        setDesc(c.description)
        setEditingDesc(false)
      })
      .catch(e => { if (alive) setFailure(e.message || t("读取失败，请重试")) })
    api
      .cardActivities(openId)
      .then((a) => alive && setActs(a))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [openId, retry, setOpenCard])


  useEffect(() => {
    if (!openId || card?.id !== openId || !openSection) return
    const frame = requestAnimationFrame(() => {
      const section = openSection === 'comments' ? commentsRef.current : attachmentsRef.current
      section?.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
      if (openSection === 'comments') section?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [openId, card?.id, openSection])

  const html = useMemo(() => (editingDesc ? '' : renderCardMarkdown(desc)), [desc, editingDesc])

  function requestClose() {
    if (busy || mutation.current) return
    if (card && ((editingDesc && desc !== card.description) || titleDraft.trim() !== card.title || dueDraft !== (card.due_date?.slice(0,10) ?? '') || (clAdding && !!clTitle.trim()) || !!editingChecklist || (!!editingItem && editingItem.text.trim() !== editingItem.original) || Object.values(newItem).some(text => !!text.trim()))) { setDiscardOpen(true); return }
    setOpenCard(null)
  }
  if (!presence.mounted || !board) return null
  if (!card || (openId && card.id !== openId)) return createPortal(<div className="motion-layer" data-motion={presence.phase} aria-hidden={!openId || undefined} {...(!openId ? { inert: '' } : {})}><div className="fade-in fixed inset-0 z-30 bg-black/25" onClick={() => setOpenCard(null)} /><aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t("卡片详情")} tabIndex={-1} className="slide-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-drawer"><div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3"><h3 className="text-sm">{t("卡片详情")}</h3><button aria-label={t("关闭卡片详情")} onClick={() => setOpenCard(null)} className="grid h-7 w-7 place-items-center"><Icon name="close" size={18} /></button></div><div className="p-5"><p role={failure ? 'alert' : 'status'} className="text-[13px] text-[var(--muted)]">{failure || t("正在读取卡片详情…")}</p>{failure && <Button className="mt-3" onClick={() => setRetry(v => v+1)}>{t("重试")}</Button>}</div></aside></div>, document.body)


  const total = card.checklists?.reduce((n, c) => n + c.items.length, 0) ?? 0
  const done = card.checklists?.reduce((n, c) => n + c.items.filter((i) => i.done).length, 0) ?? 0

  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    if (mutation.current || !currentId.current) return false
    const id = card!.id
    const previousInput=document.activeElement as HTMLElement|null
    mutation.current = true; setBusy(true); setFailure('')
    try {
      await action()
      const fresh = await api.getCard(id)
      updateCardLocal(fresh)
      if (currentId.current === id) { setCard(fresh); setTitleDraft(fresh.title) }
      void reloadBoard()
      return true
    } catch (e: any) { if (currentId.current === id) setFailure(e.message || t("保存失败，请重试")); return false }
    finally {
      mutation.current=false
      if(currentId.current===id){
        setBusy(false)
        if(previousInput && ['INPUT','TEXTAREA','SELECT'].includes(previousInput.tagName)) requestAnimationFrame(()=>{if(currentId.current===id && previousInput.isConnected && document.activeElement===document.body)previousInput.focus()})
      }
    }
  }
  async function patch(v: Record<string, unknown>, _local?: Partial<Card>) {
    return mutate(() => api.updateCard(card!.id, v))
  }
  async function saveDesc() {
    if (await patch({ description: desc })) setEditingDesc(false)
  }
  async function toggleLabel(labelId: number, on: boolean) {
    await mutate(() => api.setCardLabel(card!.id, labelId, on))
  }
  async function addChecklist(title: string) {
    if (!title.trim()) return
    if (await mutate(() => api.createChecklist(card!.id, title.trim()))) { setClTitle(''); setClAdding(false) }
  }
  async function addItem(list: Checklist) {
    const text = (newItem[list.id] ?? '').trim()
    if (!text) return
    if (await mutate(() => api.createItem(list.id, text))) setNewItem(drafts => ({ ...drafts, [list.id]: '' }))
  }
  async function toggleItem(itemId: number, done: boolean) {
    await mutate(() => api.updateItem(itemId, { done }))
  }
  async function upload(file: File) {
    await mutate(() => api.uploadAttachment(card!.id, file))
  }
  const due = dueState(card.due_date)

  return createPortal(
    <div className="motion-layer" data-motion={presence.phase} aria-hidden={!openId || undefined} {...(!openId ? { inert: '' } : {})}>
      <div className="fade-in fixed inset-0 z-30 bg-black/25" onClick={requestClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t("卡片详情")} tabIndex={-1} className="slide-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col border-l border-black/[0.08] bg-white shadow-drawer dark:border-white/[0.1] dark:bg-[#202024]">
        <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.08]">
          <CardColumnSelect disabled={busy || !openId} value={card.column_id} columns={board.columns} onChange={columnId => mutate(() => api.moveCard(card.id, columnId, 0))} />
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
            onClick={requestClose}
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[17px] leading-none opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            title={t("关闭 (Esc)")}
            aria-label={t("关闭卡片详情")}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <fieldset disabled={busy || !openId} className="card-drawer-body scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {failure && <p role="alert" className="mb-3 text-[12px] text-red-600">{failure}</p>}
          <p role="status" className="mb-3 min-h-[18px] text-[11px] text-[var(--muted)]">{busy ? t("正在保存…") : t("标签、封面和清单自动保存；日期和描述编辑后点击保存。")}</p>
          <AutoTextarea
            ref={titleRef}
            aria-label={t("卡片标题")}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            rows={1}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== card.title) void patch({ title: v }, { title: v })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            className="mb-4 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-medium leading-[1.5] outline-none hover:border-black/[0.1] focus:border-brand-400 dark:hover:border-white/[0.12]"
          />

          {/* 标签 */}
          <Section title={t("标签")}>
            <div className="flex flex-wrap items-center gap-1.5">
              {board.labels.map((l) => {
                const on = card.labels.some((x) => x.id === l.id)
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id, !on)}
                    className={cx(
                      'colored-label rounded-md px-2 py-1 text-[12px] transition-all',
                      on ? 'ring-1 ring-inset' : 'opacity-45 hover:opacity-80',
                    )}
                    style={
                      (on
                        ? { background: l.color + '22', '--label-color': l.color, boxShadow: `inset 0 0 0 1px ${l.color}` }
                        : { background: l.color + '14', '--label-color': l.color }) as React.CSSProperties & { '--label-color': string }
                    }
                  >
                    {l.name || t("未命名")}
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
                    <Icon name="plus" size={14} />{t("标签")} </button>
                )}
              >
                {(close) => (
                  <LabelEditor
                    boardId={board.id}
                    onDone={async label => {
                      const applied = await mutate(() => api.setCardLabel(card.id,label.id,true))
                      await reloadBoard()
                      if (applied) close()
                      else throw new Error(t("标签已创建，添加到卡片失败，请重试"))
                    }}
                  />
                )}
              </Menu>
            </div>
          </Section>

          {/* 截止日期 / 封面 */}
          <div className="drawer-date-cover grid grid-cols-2 gap-4">
            <Section title={t("截止日期")}>
              <Input
                type="date"
                aria-label={t("截止日期")}
                value={dueDraft}
                onInput={e=>setDueDraft(e.currentTarget.value)}
                onChange={e=>setDueDraft(e.target.value)}
              />
              {dueDraft !== (card.due_date?.slice(0,10) ?? '') && <Button size="sm" variant="primary" className="mt-2" onClick={async()=>{await patch({due_date:dueDraft})}}>{t("保存日期")}</Button>}
              {card.due_date && (
                <button
                  onClick={async () => {if(await patch({due_date:''}))setDueDraft('')}}
                  className="mt-1.5 text-[12px] opacity-50 hover:opacity-90"
                >
                  {t("清除")} </button>
              )}
            </Section>
            <Section title={t("封面颜色")}>
              <CardCoverPicker key={card.id} cover={card.cover || ''} busy={busy} onSave={cover=>patch({cover})} />
            </Section>
          </div>

          {/* 描述 */}
          <Section
            title={t("描述")}
            action={
              <button
                onClick={() => (editingDesc ? saveDesc() : setEditingDesc(true))}
                className="text-[12px] opacity-55 hover:opacity-100"
              >
                {editingDesc ? t("保存") : t("编辑")}
              </button>
            }
          >
            {editingDesc ? (
              <div>
                <AutoTextarea
                  autoFocus
                  aria-label={t("卡片描述")}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={8}
                  placeholder={t("支持 Markdown：**粗体**、`代码`、- 列表、> 引用")}
                  className="w-full resize-y rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-brand-400 dark:border-white/[0.14] dark:bg-white/[0.06]"
                />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={saveDesc}>
                    {t("保存")} </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDesc(card.description)
                      setEditingDesc(false)
                    }}
                  >
                    {t("取消")} </Button>
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
                {t("添加更详细的描述…")} </button>
            )}
          </Section>

          {/* 清单 */}
          <Section title={total ? t("子任务清单 · {0}/{1}", [done, total]) : t("子任务清单")}>
            {clAdding ? (
              <div className="checklist-composer mb-3 flex items-center gap-2">
                <Input
                  autoFocus
                  aria-label={t("清单名称")}
                  maxLength={120}
                value={clTitle}
                  placeholder={t("清单名称，如：上线准备")}
                  onChange={(e) => setClTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && clTitle.trim()) {
                      e.preventDefault()
                      void addChecklist(clTitle)
                    }
                    if (e.key === 'Escape') { setClAdding(false); setClTitle('') }
                  }}
                  className="h-8 flex-1"
                />
                <Button size="sm" variant="primary" disabled={busy || !clTitle.trim()} onClick={() => void addChecklist(clTitle)}>{t("添加")}</Button>
                <Button size="sm" onClick={() => { setClAdding(false); setClTitle('') }}>
                  {t("取消")} </Button>
              </div>
            ) : (
              <button
                onClick={() => setClAdding(true)}
                className="mb-3 text-[12px] opacity-55 hover:opacity-100"
              >
                <Icon name="plus" size={14} />{t("添加子任务清单")} </button>
            )}
            {(card.checklists ?? []).map((cl) => (
              <div key={cl.id} className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  {editingChecklist?.id === cl.id ? <form className="checklist-composer flex min-w-0 flex-1 items-center gap-2" onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault() }} onSubmit={async e => { e.preventDefault(); if (editingChecklist.title.trim() && await mutate(() => api.updateChecklist(cl.id, editingChecklist.title.trim()))) setEditingChecklist(null) }}><Input autoFocus aria-label={t("编辑清单名称")} maxLength={120} value={editingChecklist.title} onChange={e => setEditingChecklist({ id: cl.id, title: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditingChecklist(null) } }} /><Button size="sm" type="submit" variant="primary" disabled={busy || !editingChecklist.title.trim()}>{t("保存")}</Button><Button size="sm" onClick={() => setEditingChecklist(null)}>{t("取消")}</Button></form> : <><span className="min-w-0 break-words text-[12.5px] font-medium">{cl.title}</span><span className="text-[11px] text-[var(--muted)]">{cl.items.filter(it => it.done).length}/{cl.items.length}</span><button aria-label={t("编辑清单：{0}", [cl.title])} onClick={() => setEditingChecklist({ id: cl.id, title: cl.title })} className="ml-auto text-[11px] text-[var(--muted)] hover:text-[var(--accent)]">{t("编辑")}</button></>}
                  {editingChecklist?.id !== cl.id && <button
                    aria-label={t("删除清单：{0}", [cl.title])}
                    onClick={() => setDeletion({ kind: 'checklist', id: cl.id, name: cl.title })}
                    className="text-[11px] opacity-35 hover:opacity-90"
                  >
                    {t("删除")} </button>}
                </div>
                <div className="space-y-0.5">
                  {cl.items.map((it) => editingItem?.id === it.id ? (
                    <form key={it.id} className="checklist-item-editor" onSubmit={async e => {
                      e.preventDefault()
                      const text = editingItem.text.trim()
                      if (!text || busy) return
                      if (text === editingItem.original || await mutate(() => api.updateItem(it.id, { text }))) setEditingItem(null)
                    }}>
                      <Input autoFocus data-escape-local aria-label={t("编辑清单项")} maxLength={2000} value={editingItem.text} disabled={busy}
                        onChange={e => setEditingItem({ ...editingItem, text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
                          if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (!busy) setEditingItem(null) }
                        }} />
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" type="submit" variant="primary" disabled={busy || !editingItem.text.trim()}>{t("保存")}</Button>
                        <Button size="sm" disabled={busy} onClick={() => setEditingItem(null)}>{t("取消")}</Button>
                      </div>
                    </form>
                  ) : (
                    <div key={it.id} className="group flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
                      <input
                        type="checkbox"
                        aria-label={t("完成清单项：{0}", [it.text])}
                        checked={it.done}
                        onChange={(e) => toggleItem(it.id, e.target.checked)}
                        className="mt-[3px] h-3.5 w-3.5 accent-brand-600"
                      />
                      <span
                        className={cx(
                          'min-w-0 flex-1 break-words text-[13px] leading-[1.5]',
                          it.done && 'opacity-40 line-through',
                        )}
                      >
                        {it.text}
                      </span>
                      <button type="button" disabled={busy || !!editingItem} aria-label={t("编辑清单项：{0}", [it.text])} title={t("编辑")}
                        onClick={() => setEditingItem({ id: it.id, text: it.text, original: it.text })}
                        className="checklist-item-action"><Icon name="edit" size={15} /></button>
                      <button
                        aria-label={t("删除清单项：{0}", [it.text])}
                        onClick={() => setDeletion({ kind: 'item', id: it.id, name: it.text })}
                        className="checklist-item-action"
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1.5 pl-1">
                  <input
                    aria-label={t("添加清单项到{0}", [cl.title])}
                    value={newItem[cl.id] ?? ''}
                    onChange={(e) => setNewItem({ ...newItem, [cl.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void addItem(cl) }
                    }}
                    placeholder={t("添加一项，回车确认")}
                    className="h-7 min-w-0 flex-1 rounded-md border border-black/[0.1] bg-transparent px-2 text-[12.5px] outline-none focus:border-brand-400 dark:border-white/[0.14]"
                  />
                </div>
              </div>
            ))}
            {!card.checklists?.length && (
              <p className="text-[12.5px] opacity-40">{t("将任务拆成可勾选的小步骤，卡面会显示完成进度。")}</p>
            )}
          </Section>

          {/* 附件 */}
          <div ref={attachmentsRef} className="drawer-section-anchor">
          <Section
            title={t("附件")}
            action={
              <button onClick={() => fileRef.current?.click()} className="text-[12px] opacity-55 hover:opacity-100">
                <Icon name="upload" size={14} />{t("上传")} </button>
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
            <p className="mb-2 text-[11px] text-[var(--muted)]">{t("单个文件最大 32 MB；支持图片、PDF、音视频、文本及已启用的 Office 文档预览。")}</p>
            {!card.attachments?.length ? <Empty compact text={t("还没有附件")} /> : <AttachmentList attachments={card.attachments} onDelete={a => setDeletion({ kind: 'attachment', id: a.id, name: a.name })} />}
          </Section>
          </div>

          <div ref={commentsRef} className="drawer-section-anchor" style={openSection === 'comments' ? { minHeight: 'calc(100dvh - 130px)' } : undefined}><CardComments key={`comments:${card.id}`} cardId={card.id} /></div>

          {/* 活动 */}
          {acts.length > 0 && (
            <Section title={t("活动")}>
              <ul className="space-y-1.5">
                {acts.slice(0, 12).map((a) => (
                  <li key={a.id} className="text-[12px] opacity-60">
                    <span className="font-medium">{a.username || t("某人")}</span> {activityText(a.type)}{' '}
                    {a.detail && <span className="opacity-70">「{a.detail}」</span>}
                    <span className="ml-1 opacity-50">{new Date(a.created_at).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </fieldset>

        <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.07] px-4 py-3 dark:border-white/[0.08]">
          <Button size="sm" disabled={busy} onClick={() => void patch({ pinned: !card.pinned })}><Icon name="pin" size={14} />{t(card.pinned ? "取消固定" : "固定到列表顶部")}</Button>
          <Button size="sm" disabled={busy} onClick={async () => { if (await patch({ archived: true })) setOpenCard(null) }}>
            {t("归档")} </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => setDeleteOpen(true)}
          >
            {t("删除卡片")} </Button>
          <span className="ml-auto text-[11px] opacity-35">
            {t("创建于")} {new Date(card.created_at).toLocaleDateString(locale())}
          </span>
        </div>
      </aside>
      <ConfirmDialog open={deleteOpen} danger title={t("删除卡片")} okText={t("删除卡片")} message={t("删除「{0}」及其清单、评论、附件？此操作不可恢复。", [card.title])} onClose={() => setDeleteOpen(false)} onOK={async () => { await api.deleteCard(card.id); removeCardLocal(card.id); setOpenCard(null) }} />
      <ConfirmDialog open={discardOpen} title={t("放弃未保存的内容？")} message={t("标题、日期、描述或清单还有未保存的修改，关闭后会丢失。")} okText={t("放弃修改")} onClose={() => setDiscardOpen(false)} onOK={() => { setDiscardOpen(false); setOpenCard(null) }} />
      <ConfirmDialog open={!!deletion} danger title={t("确认删除")} okText={t("删除")} message={t("删除「{0}」？此操作不可恢复。", [deletion?.name])} onClose={() => setDeletion(null)} onOK={async () => { if (!deletion) return; const target=deletion; const ok=await mutate(() => target.kind==='item' ? api.deleteItem(target.id) : target.kind==='checklist' ? api.deleteChecklist(target.id) : api.deleteAttachment(target.id)); if (!ok) throw new Error(t("删除失败，请重试")) }} />
    </div>, document.body
  )
}

function activityText(type: string) {
  return (
    {
      created: t("创建了卡片"),
      archived: t("归档了卡片"),
      restored: t("恢复了卡片"),
      moved: t("移动了卡片"),
      updated: t("更新了卡片"),
    }[type] ?? t("操作了卡片")
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
  useLanguage()
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[12px] font-medium text-[var(--muted)]">{title}</h4>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}

function LabelEditor({ boardId, onDone }: { boardId: number; onDone: (label: Label) => Promise<void> }) {
  useLanguage()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#629FF0')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const created=useRef<Label|null>(null)
  const palette = COLOR_PALETTE.map(([, color]) => color)

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true);setError('')
    try {
      const label=created.current ?? await api.createLabel(boardId,name.trim(),color)
      created.current=label
      await onDone(label)
    } catch(e:any){setError(e.message || t("创建失败，请重试"))} finally{setBusy(false)}
  }

  return (
    <div className="px-3 py-2">
      <input
        autoFocus
        aria-label={t("新标签名称")}
        disabled={busy || !!created.current}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()}
        placeholder={t("标签名")}
        className="mb-2 h-8 w-full rounded-md border border-black/[0.12] bg-transparent px-2 text-[13px] outline-none dark:border-white/[0.14]"
      />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button
            key={c}
            aria-label={t("标签颜色 {0}", [c])}
            disabled={busy || !!created.current}
            onClick={() => setColor(c)}
            className={cx('h-5 w-5 rounded', color === c ? 'ring-2 ring-brand-400' : '')}
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs text-[var(--muted)]">{t("自定义颜色")}<input type="color" aria-label={t("自定义标签颜色")} value={color} disabled={busy || !!created.current} onInput={e => setColor(e.currentTarget.value)} onChange={e => setColor(e.target.value)} className="native-color-input" /><span className="font-mono text-[10px]">{color.toUpperCase()}</span></label>
      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
      <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={create} className="w-full">
        {busy ? t("保存中…") : t("创建并添加")}
      </Button>
    </div>
  )
}
