import { notify } from './notifications'
import { useLanguage } from './useLanguage'
import { locale } from './i18n'
import { t } from './i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { shareApi, shareLink, permissionNames } from './shareApi'
import type { ShareEntry } from './shareApi'
import { useStore } from './store'
import { Button, ConfirmDialog, Input, Menu, MenuItem, MenuSep, Modal } from './ui'

type Status = 'all' | 'active' | 'expired' | 'disabled'
function statusOf(sh: ShareEntry, now: number): Status {
  if (!sh.enabled || sh.board_archived) return 'disabled'
  return sh.expires_at && new Date(sh.expires_at).getTime() <= now ? 'expired' : 'active'
}
const statusOrder: Status[] = ['all', 'active', 'expired', 'disabled']
const statusNames: Record<Status, string> = { get all() { return t("全部") }, get active() { return t("分享中") }, get expired() { return t("已过期") }, get disabled() { return t("已停用") } }
export default function ShareCenter({ revision, onConfigure, onCreate }: { revision: number; onConfigure: (id: string) => void; onCreate:()=>void }) {
  useLanguage()
  const workspaceId = useStore(s => s.workspaceId)
  const [shares, setShares] = useState<ShareEntry[]>([])
  const [status, setStatus] = useState<Status>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [action, setAction] = useState<{ kind: 'disable' | 'remove'; share: ShareEntry } | null>(null)
  const [manualLink, setManualLink] = useState('')
  const [now, setNow] = useState(Date.now())
  const request = useRef(0)
  const openBoard = useStore(s => s.openBoard)
  const load = useCallback(async () => {
    const version = ++request.current
    setLoading(true); setError('')
    try { const rows = await shareApi.list(workspaceId ?? undefined); if (version === request.current) setShares(rows) } catch (e: any) { if (version === request.current) setError(e.message) } finally { if (version === request.current) setLoading(false) }
  }, [workspaceId])
  useEffect(() => { void load(); return () => { ++request.current } }, [load, revision])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  const filtered = useMemo(() => shares.filter(sh => (status === 'all' || statusOf(sh, now) === status) && `${sh.name} ${sh.board_name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [shares, status, search, now])
  async function copy(sh: ShareEntry) {
    setBusy(sh.id); setError('')
    try {
      const saved = await shareApi.settings(sh.id)
      if (saved.board_archived || !saved.enabled || (saved.expires_at && new Date(saved.expires_at).getTime() <= Date.now())) { await load(); throw new Error(t("该链接已失效，请先调整分享设置")) }
      const link = shareLink(saved)
      if (!link) throw new Error(t("链接不存在，请重新设置分享"))
      try { await navigator.clipboard.writeText(link); notify(t("「{0}」的链接已复制", [sh.name])) } catch { setManualLink(link); notify(t("请手动复制下面的链接"),'info') }
    } catch (e: any) { setError(e.message); notify(e.message,'error') } finally { setBusy(null) }
  }
  return <div className="share-center scroll-thin">
    <div className="share-center-heading"><div><h1>{t("分享管理")}</h1><p>{t("每条链接独立管理，修改设置后地址保持不变。")}</p></div><div className="flex gap-2"><Button variant="primary" onClick={onCreate}><Icon name="plus" size={16}/>{t("新建分享")}</Button><Button disabled={loading} onClick={() => void load()}><Icon name="refresh" size={16} className={loading ? "animate-spin" : ""} />{loading ? t("正在加载…") : t("刷新")}</Button></div></div>
    <div className="share-center-controls"><div className="share-tabs" role="tablist" aria-label={t("分享状态")}>{statusOrder.map(value => <button key={value} role="tab" aria-selected={status === value} tabIndex={status === value ? 0 : -1} onKeyDown={e => {
      const index = statusOrder.indexOf(value)
      const target = e.key === 'ArrowRight' ? (index + 1) % 4 : e.key === 'ArrowLeft' ? (index + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1
      if (target < 0) return
      e.preventDefault(); setStatus(statusOrder[target]); (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target])?.focus()
    }} className={status === value ? 'selected' : ''} onClick={() => setStatus(value)}>{statusNames[value]}<span>{shares.filter(sh => value === 'all' || statusOf(sh, now) === value).length}</span></button>)}</div><div className="share-search"><Icon name="search" size={16} /><Input aria-label={t("搜索分享名称或看板")} value={search} onChange={e => setSearch(e.target.value)} placeholder={t("搜索名称或看板…")} /></div></div>
    {error && <p role="alert" className="error-banner">{error}<button onClick={() => void load()}>{t("重试")}</button></p>}
    {loading && !shares.length ? <div role="status" className="share-empty">{t("正在读取分享记录…")}</div> : error && !shares.length ? null : !filtered.length ? <div className="share-empty"><h2>{shares.length ? t("没有匹配的分享记录") : t("还没有分享记录")}</h2>{(search || status !== 'all') && <Button onClick={() => { setSearch(''); setStatus('all') }}>{t("清除筛选")}</Button>}</div> : <div className="share-list" aria-label={t("已分享的链接")}>{filtered.map(sh => {
      const state = statusOf(sh, now)
      const permissions = Object.entries(sh.permissions).filter(([, allowed]) => allowed).map(([key]) => permissionNames[key as keyof typeof permissionNames])
      return <article className="share-row" key={sh.id}>
        <div className="share-row-icon"><Icon name="board" size={20} /></div>
        <div className="share-row-content"><div className="share-row-title"><button onClick={() => onConfigure(sh.id)} title={t("编辑分享")}>{sh.name}</button><span className={`share-status ${state}`}>{statusNames[state]}</span></div><p className="share-board-name">{sh.board_name}{sh.board_archived ? t("（已归档）") : ''}</p><div className="share-permissions">{permissions.length ? permissions.map(p => <span key={p}>{p}</span>) : <span>{t("仅查看")}</span>}</div><div className="share-row-meta"><span><Icon name="clock" size={13} />{sh.expires_at ? t("{0} 到期", [new Date(sh.expires_at).toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })]) : (state === 'active' ? t("永久有效") : t("未设置到期时间"))}</span><span>{state === 'active' ? sh.sessions : 0}  {t("个有效访客会话")}</span></div></div>
        <div className="share-row-actions"><Button size="sm" disabled={state !== 'active' || busy === sh.id} onClick={() => void copy(sh)}><Icon name="copy" size={15} />{busy === sh.id ? t("复制中…") : t("复制链接")}</Button><Button size="sm" onClick={() => onConfigure(sh.id)}><Icon name="settings" size={15} />{t("编辑")}</Button><Menu trigger={(_, toggle) => <button className="icon-button" aria-label={t("管理分享：{0}", [sh.name])} onClick={toggle}><Icon name="more" /></button>}>
          {close => <>{!sh.board_archived && <><MenuItem onClick={() => { close(); void openBoard(sh.board_id) }}><Icon name="external" size={16} />{t("进入看板")}</MenuItem><MenuSep /></>}{state !== 'disabled' && <MenuItem danger onClick={() => { close(); setAction({ kind: 'disable', share: sh }) }}><Icon name="close" size={16} />{t("停用分享")}</MenuItem>}<MenuItem danger onClick={() => { close(); setAction({ kind: 'remove', share: sh }) }}><Icon name="trash" size={16} />{t("删除分享记录")}</MenuItem></>}
        </Menu></div>
      </article>
    })}</div>}
    {!!shares.length && <p className="share-center-footnote">{t("链接停用、到期或删除后，访客的下一次请求会被拒绝。删除分享记录会撤销访问，保留看板内容。")}</p>}
    <ConfirmDialog open={!!action} danger title={action?.kind === 'remove' ? t("删除分享记录") : t("停用分享")} okText={action?.kind === 'remove' ? t("删除记录") : t("停用分享")} message={action?.kind === 'remove' ? t("删除「{0}」这条分享记录？旧链接与访客会话会失效，看板内容会保留。", [action.share.name]) : t("停用「{0}」的分享？访客将无法继续访问。之后可在设置里重新开启。", [action?.share.name])} onClose={() => setAction(null)} onOK={async () => {
      if (!action) return
      if (action.kind === 'remove') await shareApi.remove(action.share.id)
      else { const latest = await shareApi.settings(action.share.id); await shareApi.save(action.share.id, { name:latest.name, enabled: false, expires_at: latest.expires_at, permissions: latest.permissions }) }
      notify(action.kind === 'remove' ? t("分享记录已删除，看板内容保留") : t("分享已停用")); await load(); await useStore.getState().loadBoards()
    }} />
    <Modal open={!!manualLink} title={t("复制分享链接")} onClose={() => setManualLink('')}><p className="mb-3 text-[13px]">{t("选中下面的链接即可手动复制。")}</p><Input aria-label={t("分享链接")} readOnly value={manualLink} onFocus={e => e.target.select()} /></Modal>
  </div>
}
