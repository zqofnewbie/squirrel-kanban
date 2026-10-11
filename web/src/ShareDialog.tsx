import { notify } from './notifications'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { boardColor } from './boardColors'
import Icon from './Icon'
import { useEffect, useState } from 'react'
import { useStore } from './store'
import { shareApi, noPermissions, shareLink } from './shareApi'
import type { BoardShare, SharePermissions } from './shareApi'
import { Button, ConfirmDialog, Input, Modal, Select } from './ui'

const options: { key: keyof SharePermissions; label: string; detail: string }[] = [
  { key: 'download', get label() { return t("下载附件") }, get detail() { return t("查看与下载附件") } },
  { key: 'comment', get label() { return t("发表评论") }, get detail() { return t("在卡片下留言") } },
  { key: 'checklist', get label() { return t("勾选清单") }, get detail() { return t("更新清单完成状态") } },
  { key: 'move', get label() { return t("移动卡片") }, get detail() { return t("换列表、调整顺序") } },
  { key: 'edit', get label() { return t("编辑卡片") }, get detail() { return t("修改标题、描述与截止日期") } },
  { key: 'pin', get label() { return t('固定卡片') }, get detail() { return t('固定到列表顶部或取消固定') } },
  { key: 'cover', get label() { return t('修改封面') }, get detail() { return t('设置或清除卡片封面颜色') } },
  { key: 'create', get label() { return t("新建卡片") }, get detail() { return t("在已有列表里添加任务") } },
]
const localDate = (iso: string) => {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
export default function ShareDialog({ boardId, shareId, onClose, onSaved }: { boardId?: number; shareId?: string; onClose: () => void; onSaved?: () => void }) {
  useLanguage()
  const [visible, setVisible] = useState(true)
  useEffect(() => { if (visible) return; const timer = window.setTimeout(onClose, 180); return () => window.clearTimeout(timer) }, [visible, onClose])
  const finishClose = () => setVisible(false)
  const boards = useStore(s=>s.boards)
  const initialBoard=boardId ?? boards[0]?.id ?? 0
  const initialName=(boards.find(b=>b.id===initialBoard)?.name ?? '')+t(" · 分享")
  const [selectedBoard,setSelectedBoard]=useState(initialBoard)
  const [name,setName]=useState(initialName)
  const [saved, setSaved] = useState<BoardShare | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [permissions, setPermissions] = useState<SharePermissions>(noPermissions)
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(!!shareId)
  const [loaded, setLoaded] = useState(!shareId)
  const [error, setError] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [manualLink, setManualLink] = useState('')
  const [retry,setRetry]=useState(0)
  const dirty = loaded && (saved ? name !== saved.name || enabled !== saved.enabled || expiry !== localDate(saved.expires_at) || JSON.stringify(permissions) !== JSON.stringify(saved.permissions) : name!==initialName || selectedBoard!==initialBoard || !enabled || !!expiry || Object.values(permissions).some(Boolean))
  const link = saved ? shareLink(saved) : ''
  const active = !saved?.board_archived && !!saved?.enabled && (!saved.expires_at || new Date(saved.expires_at).getTime() > Date.now())
  useEffect(() => {
    if (!shareId) return
    let alive = true
    setBusy(true);setError('')
    shareApi.settings(shareId).then(sh => {
      if (!alive) return
      setSaved(sh);setName(sh.name);setSelectedBoard(sh.board_id);setEnabled(sh.enabled);setPermissions({ ...noPermissions, ...sh.permissions });setExpiry(localDate(sh.expires_at));setLoaded(true)
    }).catch(e => { if (alive) setError(e.message) }).finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [shareId,retry])
  async function save() {
    if (!name.trim()) {setError(t("请填写分享名称"));notify(t("请填写分享名称"),'error');return}
    if (enabled && expiry && new Date(expiry).getTime() <= Date.now()) { setError(t("请选择未来的到期时间")); notify(t("请选择未来的到期时间"),'error'); return }
    setBusy(true);setError('');setManualLink('')
    try {
      const value={name:name.trim(),enabled,permissions,expires_at:expiry ? new Date(expiry).toISOString() : ''}
      const sh = saved ? await shareApi.save(saved.id,value) : await shareApi.createRecord({...value,board_id:selectedBoard})
      setSaved(sh);setName(sh.name);setExpiry(localDate(sh.expires_at));onSaved?.();notify(enabled ? t("已保存，链接地址保持不变") : t("分享已停用，访客访问已撤销"))
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return <>
    <Modal open={visible} title={saved || shareId ? t("编辑分享") : t("新建分享")} width={560} footer={loaded ? <>
        {dirty && <p className="mt-3 text-[12px] text-[var(--muted)]">{t("有未保存的设置，保存后再复制链接。")}</p>}
        <div className="share-dialog-footer">
          <Button disabled={busy || dirty || !active || !link} onClick={async()=>{try {await navigator.clipboard.writeText(link);notify(t("链接已复制"))}catch{setManualLink(link);notify(t("请手动复制下面的链接"),'info')}}}><Icon name="copy" size={15}/>{t("复制链接")}</Button>
          <Button variant="primary" disabled={busy || !selectedBoard} onClick={()=>void save()}>{busy?t("保存中…"):saved?t("保存修改"):t("创建分享")}</Button>
        </div>
        {manualLink && <Input aria-label={t("手动复制分享链接")} className="mt-3" value={manualLink} readOnly onFocus={e=>e.target.select()}/>}</> : undefined} onClose={() => { if (!busy) { if (dirty) setDiscardOpen(true); else finishClose() } }}>
      <p className="mb-4 text-[12px] leading-relaxed text-[var(--muted)]">{t("每条分享有独立且固定的链接。默认只读，看板内容实时更新。")}</p>
      {error && <p role="alert" className="mb-3 text-[12px] text-red-600">{error}</p>}
      {!loaded ? <div className="text-[13px]">{busy ? t("读取分享设置…") : <Button onClick={()=>setRetry(v=>v+1)}>{t("重试")}</Button>}</div> : <>
        <fieldset disabled={busy} className="share-record-fields">
          <label>{t("分享名称")}<Input autoFocus aria-label={t("分享名称")} maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder={t("例如：产品评审、客户只读")} /></label>
          <label>{t("分享的看板")}<Select fullWidth label={t("分享的看板")} disabled={busy || !!saved || !!shareId} value={selectedBoard} onChange={id=>{setSelectedBoard(id);setName((boards.find(b=>b.id===id)?.name??'')+t(" · 分享"))}} options={[...boards.map(b=>({value:b.id,label:b.name,color:boardColor(b.id)})), ...(saved && !boards.some(b=>b.id===saved.board_id) ? [{value:saved.board_id,label:t("已归档看板")}] : [])]} /></label>
        </fieldset>
        <label className="share-option mb-4"><span><strong>{t("启用链接")}</strong><small>{t("停用后立即撤销访客访问")}</small></span><input type="checkbox" className="switch-control" role="switch" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)} /></label>
        <fieldset disabled={busy} className="share-options-grid">
          <legend className="mb-2 text-[12px] font-medium">{t("协作权限")} <span className="font-normal text-[var(--muted)]">{t("· 全部关闭即为只读")}</span></legend>
          <div className="share-permission-presets"><Button size="sm" onClick={()=>setPermissions(Object.fromEntries(Object.keys(noPermissions).map(key=>[key,true])) as unknown as SharePermissions)}>{t("编辑协作 · 全选")}</Button><Button size="sm" onClick={()=>setPermissions({...noPermissions})}>{t("仅查看")}</Button></div>
          {options.map(o=><label className="share-option" key={o.key}><span><strong>{o.label}</strong><small>{o.detail}</small></span><input type="checkbox" className="switch-control" role="switch" checked={permissions[o.key]} onChange={e=>setPermissions(p=>({...p,[o.key]:e.target.checked}))}/></label>)}
          <label htmlFor="share-expiry" className="mb-2 mt-3 block text-[12px]">{t("有效期（留空为永久）")}</label>
          <Input aria-label={t("分享到期时间")} id="share-expiry" type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/>
          <div className="mt-2 flex gap-2">{[7,30].map(days=><Button size="sm" key={days} onClick={()=>setExpiry(localDate(new Date(Date.now()+days*86400000).toISOString()))}>{days}  {t("天")}</Button>)}<Button size="sm" onClick={()=>setExpiry('')}>{t("永久")}</Button></div>
        </fieldset>
        {saved && <div className="share-fixed-link"><span>{t("固定链接")}</span><Input aria-label={t("固定分享链接")} readOnly value={link} onFocus={e=>e.target.select()}/></div>}
      </>}
    </Modal>
    <ConfirmDialog open={discardOpen} title={t("放弃未保存的设置？")} message={t("本次修改还没有保存，关闭后会丢失。")} okText={t("放弃修改")} onClose={()=>setDiscardOpen(false)} onOK={()=>{setDiscardOpen(false);finishClose()}}/>
  </>
}
