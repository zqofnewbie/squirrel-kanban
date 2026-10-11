import { CardColumnSelect, CardCoverPicker, renderCardMarkdown } from './CardDetailControls'
import { useLanguage } from './useLanguage'
import LanguageToggle from './LanguageToggle'
import { t } from './i18n'
import { SharedDrag, SharedDropColumn } from './SharedDrag'
import BoardCanvas from './BoardCanvas'
import CardTile from './CardTile'
import GuestCardList from './GuestCardList'
import ThemeToggle from './ThemeToggle'
import { boardBackground } from './backgrounds'
import AttachmentList from './Attachments'
import type { CardSection } from './store'
import Icon from './Icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Brand from './Brand'
import CardComments from './CardComments'
import { ApiError } from './api'
import { shareApi, noPermissions } from './shareApi'
import type { SharePermissions } from './shareApi'
import type { BoardDetail, Card } from './types'
import { Button, Input, Modal, Progress, PromptDialog, Textarea, formatDate } from './ui'
import { useStore } from './store'

export default function SharedBoard({ shareId }: { shareId: string }) {
  const language = useLanguage()
  const [board, setBoard] = useState<BoardDetail | null>(null)
  const [permissions, setPermissions] = useState<SharePermissions>(noPermissions)
  const [search, setSearch] = useState('')
  const [card, setCard] = useState<Card | null>(null)
  const [openSection, setOpenSection] = useState<CardSection | null>(null)
  const attachmentsRef = useRef<HTMLDivElement>(null)
  const commentsRef = useRef<HTMLDivElement>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<{ title: string; description: string; due_date: string } | null>(null)
  const [createColumn, setCreateColumn] = useState<number | null>(null)
  const cardIdRef = useRef<number | null>(null)
  const terminalRef = useRef(false)
  const mountedRef = useRef(true)
  const versionRef = useRef('')
  const loadingRef = useRef(false)
  const draggingRef = useRef(false)
  const theme = useStore(s => s.theme)
  const collaboration = Object.entries(permissions).some(([key, value]) => key !== 'download' && value)
  const html = useMemo(() => renderCardMarkdown(card?.description ?? ''), [card?.description])
  const reject = useCallback((e: unknown) => {
    if (!mountedRef.current) return
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      terminalRef.current = true; setFailure(e.message); setBoard(null); setCard(null); setEdit(null); setCreateColumn(null); cardIdRef.current = null
    } else setError(e instanceof Error ? e.message : t("连接失败，请稍后重试"))
  }, [])
  const refresh = useCallback(async () => {
    if (terminalRef.current || loadingRef.current || draggingRef.current) return
    loadingRef.current = true; setRefreshing(true)
    try {
      const result = await shareApi.board(shareId, versionRef.current)
      if (!mountedRef.current || terminalRef.current || draggingRef.current) return
      versionRef.current = result.version
      if (!result.unchanged) { setBoard(result.board); setPermissions(result.permissions) }
      setError('')
      const selected = cardIdRef.current
      if (selected !== null) {
        try { const detail = await shareApi.card(shareId, selected); if (mountedRef.current && cardIdRef.current === selected) setCard(detail) }
        catch (e) { if (e instanceof ApiError && e.status === 404) { cardIdRef.current = null; setCard(null); setEdit(null) } else throw e }
      }
    } catch (e) { reject(e) } finally { loadingRef.current = false; if (mountedRef.current) setRefreshing(false) }
  }, [shareId, reject])
  useEffect(() => {
    mountedRef.current = true
    document.documentElement.classList.toggle('dark', theme === 'dark')
    async function init() {
      const key = new URLSearchParams(location.hash.slice(1)).get('key')
      if (key) history.replaceState(null, '', location.pathname + location.search)
      try {
        if (key || shareId.length === 22) await shareApi.session(shareId, key ?? '')
        await refresh()
      } catch (e) { reject(e) } finally { if (mountedRef.current) setReady(true) }
    }
    void init()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 15000)
    const focus = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', focus)
    return () => { mountedRef.current = false; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [shareId, refresh, reject])
  useEffect(() => { document.title = board ? t("{0} · 共享看板", [board.name]) : t("共享看板 · 松鼠看板") }, [board?.name, language])
  async function openCard(id: number, section?: CardSection) {
    setOpenSection(section ?? null)
    cardIdRef.current = id; setCard(null); setEdit(null); setError(''); setCardLoading(true)
    try { const detail = await shareApi.card(shareId, id); if (mountedRef.current && cardIdRef.current === id) setCard(detail) }
    catch (e) { reject(e) } finally { if (cardIdRef.current === id) setCardLoading(false) }
  }
  useEffect(() => {
    if (!card || !openSection) return
    const frame = requestAnimationFrame(() => (openSection === 'comments' ? commentsRef.current : attachmentsRef.current)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [card?.id, openSection])
  function closeCard() { if (!busy) { cardIdRef.current = null; setCard(null); setEdit(null); setCardLoading(false) } }
  async function mutate(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); await refresh(); return true } catch (e) {
      // 权限变更先重新读取，保留当前详情；只有会话失效才清空页面。
      await refresh(); setError(e instanceof Error ? e.message : t("操作失败")); return false
    } finally { setBusy(false) }
  }
  if (!ready) return <div className="grid h-full place-items-center text-[13px]">{t("正在打开共享看板…")}</div>
  if (failure) return <div className="login-page grid h-full place-items-center p-6"><div className="max-w-sm text-center"><div className="login-brand"><Brand /></div><h1 className="mb-3 text-lg font-medium">{t("暂时无法访问")}</h1><p role="alert" className="text-[13px] leading-relaxed text-[var(--muted)]">{failure}</p><p className="mt-3 text-[12px]">{t("请向管理员获取有效的分享链接。")}</p></div></div>
  const filter = search.trim().toLocaleLowerCase()
  return <div className="shared-shell" style={board ? boardBackground(board.background, board.id, shareId) : undefined}>
    <header className="shared-header"><Brand /><span className="shared-badge">{t("共享看板 ·")} {collaboration ? t("可协作") : t("只读")}</span><div className="ml-auto flex gap-2"><Button size="sm" disabled={refreshing} onClick={() => void refresh()}><Icon name="refresh" size={15} className={refreshing ? "animate-spin" : ""} />{refreshing ? t("正在加载…") : t("刷新")}</Button><LanguageToggle /><ThemeToggle /></div></header>
    {board ? <>
      <div className="shared-toolbar"><div><h1>{board.name}</h1><p>{board.description || t("理清思路，让每一件事都有进展。")}</p></div><Input aria-label={t("筛选共享看板")} placeholder={t("筛选标题、描述和标签…")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-[270px]" /></div>

      {error && <div role="alert" className="error-banner">{error}<button onClick={() => void refresh()}>{t("重试")}</button></div>}
      <div className="shared-canvas"><BoardCanvas key={board.id} board={board}>{(_scale, height) => <SharedDrag preview={setBoard} onDragging={active => {draggingRef.current=active}} board={board} enabled={permissions.move && !busy && !filter} move={async(id,column,before) => { await mutate(() => shareApi.move(shareId,id,column,before)) }}><main className="shared-columns" style={{height}}>{board.columns.map(col => {
        const cards = col.cards.filter(c => !filter || `${c.title} ${c.description} ${c.labels.map(l => l.name).join(' ')}`.toLocaleLowerCase().includes(filter))
        return <SharedDropColumn key={col.id} id={col.id} cards={cards} enabled={permissions.move && !busy && !filter}><div className="shared-column-heading"><h2><span className="column-color-dot" style={{background:col.color || '#94A3B8'}} />{col.name}</h2><span>{col.cards.length}</span></div>
          <GuestCardList cards={cards} filter={filter} empty={<p className="py-6 text-center text-[12px] text-[var(--muted)]">{filter ? t("没有匹配的卡片") : t("暂无卡片")}</p>} footer={permissions.create && <Button className="add-card-button w-full" disabled={busy} onClick={() => setCreateColumn(col.id)}><Icon name="plus" size={16} />{t("添加卡片")}</Button>}>{c => <CardTile key={c.id} card={c} dimmed={false} shareId={shareId} canMove={permissions.move && !busy && !filter} canEdit={permissions.edit} canPin={permissions.pin} onOpen={(id,section)=>void openCard(id,section)} onRename={async(id,title)=>{await shareApi.edit(shareId,id,{title});await refresh()}} onPin={async(id,pinned)=>{await shareApi.edit(shareId,id,{pinned});await refresh()}}/>}</GuestCardList>


        </SharedDropColumn>
      })}</main></SharedDrag>}</BoardCanvas></div><footer className="shared-sync-note">{collaboration ? t("已开启的协作操作会直接保存到看板。") : t("点击卡片查看详情，此链接仅供查看。")} <span>{t("页面每 15 秒自动更新")}</span></footer>
    </> : <p role="alert" className="m-6">{error || t("正在读取看板…")}<Button className="ml-3" onClick={() => void refresh()}>{t("重试")}</Button></p>}
    <Modal open={!!card || cardLoading} onClose={closeCard} title={card?.title ?? t("读取卡片…")} width={560} placement="right">
      {!card ? <p className="text-[13px]">{t("读取卡片详情…")}</p> : <>
        {error && <p role="alert" className="mb-3 text-[12px] text-red-600">{error}</p>}
        {permissions.move && board && <div className="mb-4 flex flex-wrap items-center gap-2"><label className="text-[12px]">{t("移动到")} <CardColumnSelect value={card.column_id} disabled={busy} columns={board.columns} onChange={value => void mutate(() => shareApi.move(shareId, card.id, value))} /></label>{(() => { const list = board.columns.find(col => col.id === card.column_id)?.cards ?? []; const index = list.findIndex(c => c.id === card.id); return <><Button size="sm" disabled={busy || index <= 0} onClick={() => void mutate(() => shareApi.move(shareId, card.id, card.column_id, list[index-1].id))}>{t("上移")}</Button><Button size="sm" disabled={busy || index < 0 || index >= list.length-1} onClick={() => void mutate(() => shareApi.move(shareId, card.id, card.column_id, list[index+2]?.id ?? 0))}>{t("下移")}</Button></> })()}</div>}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {permissions.pin && <Button size="sm" disabled={busy} onClick={() => void mutate(() => shareApi.edit(shareId, card.id, {pinned:!card.pinned}))}><Icon name="pin" size={14}/>{card.pinned ? t("取消固定") : t("固定卡片")}</Button>}
          {card.labels.map(label => <span key={label.id} className="colored-label rounded px-2 py-1 text-xs" style={{background:label.color+'22','--label-color':label.color} as React.CSSProperties}>{label.name}</span>)}
        </div>
        {permissions.cover && <div className="mb-5"><p className="mb-2 text-xs">{t("封面颜色")}</p><CardCoverPicker key={card.id} cover={card.cover || ''} busy={busy} onSave={async cover => !!(await mutate(()=>shareApi.edit(shareId,card.id,{cover})))}/></div>}
        {edit && permissions.edit ? <form className="mb-5" onSubmit={e => { e.preventDefault(); void mutate(async () => { await shareApi.edit(shareId, card.id, edit); setEdit(null) }) }}>
          <label className="mb-2 block text-[12px]">{t("标题")}<Input className="mt-1" maxLength={250} required value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
          <label className="mb-2 block text-[12px]">{t("描述")}<Textarea className="mt-1" rows={6} maxLength={20000} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
          <label className="mb-3 block text-[12px]">{t("截止日期")}<Input className="mt-1" type="date" value={edit.due_date} onChange={e => setEdit({ ...edit, due_date: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setEdit(null)}>{t("取消")}</Button><Button type="submit" variant="primary" disabled={busy || !edit.title.trim()}>{busy ? t("保存中…") : t("保存")}</Button></div>
        </form> : <div className="mb-5"><div className="mb-3 flex items-center justify-between"><span className="text-[12px] text-[var(--muted)]">{card.due_date ? t("截止 {0}", [formatDate(card.due_date)]) : t("卡片描述")}</span>{permissions.edit && <Button size="sm" onClick={() => setEdit({ title: card.title, description: card.description, due_date: card.due_date?.slice(0,10) ?? '' })}>{t("编辑内容")}</Button>}</div>{card.description ? <div className="markdown-body break-words" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-[12px] text-[var(--muted)]">{t("暂无描述")}</p>}</div>}
        {(card.checklists ?? []).map(cl => <section className="mb-5" key={cl.id}><h3 className="mb-2 text-[13px] font-medium">{cl.title}</h3><Progress done={cl.items.filter(it => it.done).length} total={cl.items.length} /><div className="mt-3 space-y-2">{cl.items.map(it => <label key={it.id} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1 accent-brand-600" checked={it.done} disabled={!permissions.checklist || busy} onChange={e => void mutate(() => shareApi.item(shareId, it.id, e.target.checked))} /><span className={it.done ? 'line-through opacity-50' : ''}>{it.text}</span></label>)}</div></section>)}
        <div ref={attachmentsRef} className="drawer-section-anchor">{permissions.download && !!card.attachments?.length && <section className="mb-5"><h3 className="mb-2 text-[13px] font-medium">{t("附件")}</h3><AttachmentList attachments={card.attachments} shareId={shareId} /></section>}</div>
        <div ref={commentsRef} className="drawer-section-anchor"><CardComments key={`comments:${card.id}`} cardId={card.id} shareId={shareId} canComment={permissions.comment} /></div>
      </>}
    </Modal>
    <PromptDialog open={createColumn !== null && permissions.create} title={t("新建卡片")} placeholder={t("要完成什么？")} okText={t("添加")} onClose={() => setCreateColumn(null)} onOK={async title => { if (createColumn !== null) { await shareApi.create(shareId, createColumn, title); await refresh() } }} />
  </div>
}
