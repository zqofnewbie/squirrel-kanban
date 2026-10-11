import { useLanguage } from './useLanguage'
import { t, workspaceName, countText } from './i18n'
import { useEffect, useId, useState } from 'react'
import { api } from './api'
import type { ManagedUser, Workspace } from './types'
import { useStore } from './store'
import { Button, ConfirmDialog, Input, Modal, Select } from './ui'
import Icon from './Icon'

export default function Administration() {
  useLanguage()
  const userFormId = useId()
  const isMember = useStore(s => s.me?.role === 'member')
  const isAdmin = useStore(s => s.me?.role === 'admin')
  const [tab, setTab] = useState<'spaces' | 'users'>('spaces')
  const [spaces, setSpaces] = useState<Workspace[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [space, setSpace] = useState<{ id?: number; name: string; description: string } | null>(null)
  const [user, setUser] = useState<{ id?: number; role: ManagedUser['role']; username: string; display_name: string; password: string; disabled: boolean; workspace_ids: number[]; manager_id?: number } | null>(null)
  const [remove, setRemove] = useState<{ type: 'space' | 'user'; id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  async function load() {
    setLoading(true); setError('')
    try { const [a, b] = await Promise.all([api.workspaces(), !isMember ? api.users() : Promise.resolve([])]); setSpaces(a); setUsers(b) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    void load()
    const refreshOnFocus = () => { void load() }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [])
  async function refresh() { await load(); await useStore.getState().loadWorkspaces() }
  async function saveSpace() {
    if (!space || busy) return
    setBusy(true); setFormError('')
    try {
      if (space.id) await api.updateWorkspace(space.id, space.name.trim(), space.description.trim())
      else await api.createWorkspace(space.name.trim(), space.description.trim())
      await refresh(); setSpace(null)
    } catch (e: any) { setFormError(e.message) } finally { setBusy(false) }
  }
  async function saveUser() {
    if (!user || busy) return
    setBusy(true); setFormError('')
    try { await api.saveUser(user.id, {...user,manager_id:isAdmin && user.role === "member" ? user.manager_id : undefined,workspace_ids:isAdmin ? user.workspace_ids : user.workspace_ids.filter(id=>spaces.some(w=>w.id===id && w.can_manage))}); await load(); setUser(null) }
    catch (e: any) { setFormError(e.message) } finally { setBusy(false) }
  }
  return <section className="administration scroll-thin">
    <div className="administration-heading"><div><h1>{!isMember ? t("空间与成员") : t("工作空间")}</h1><p>{isAdmin ? t("空间独立管理，成员按需分配。") : isMember ? t("使用管理员分配给你的工作空间。") : t("管理自己创建的空间，使用分配给你的空间。")}</p></div>{!isMember && <Button variant="primary" onClick={() => { setFormError(''); if (tab === 'spaces') setSpace({ name: '', description: '' }); else setUser({ role:'member', username: '', display_name: '', password: '', disabled: false, workspace_ids: [] }) }}><Icon name="plus" size={16} />{tab === 'spaces' ? t("新建工作空间") : t("添加成员")}</Button>}</div>
    <div className="administration-tabs" role="tablist" aria-label={t("管理分类")}><button role="tab" aria-selected={tab === 'spaces'} onClick={() => setTab('spaces')}>{t("工作空间")} <span>{spaces.length}</span></button>{!isMember && <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>{t("成员与权限")} <span>{users.length}</span></button>}</div>
    {error && <div role="alert" className="error-banner">{error}<Button onClick={() => void load()}>{t("重试")}</Button></div>}
    {loading ? <p role="status">{t("正在加载…")}</p> : error && !(tab === 'spaces' ? spaces.length : users.length) ? null : tab === 'spaces' && !spaces.length ? <div className="management-empty"><Icon name="empty" size={32}/><p>{t("暂无工作空间")}</p></div> : tab === 'users' && !users.length ? <div className="management-empty"><Icon name="empty" size={32}/><p>{t("还没有成员")}</p></div> : tab === 'spaces' ? <div className="space-grid">{spaces.map(item => <article className="space-card" key={item.id}><div className="space-card-title"><span className="space-symbol"><Icon name="board" size={20} /></span><h2>{workspaceName(item)}</h2>{item.id === 1 && <small>{t("默认")}</small>}</div><p>{item.description || t("把相关看板放在一起，专注一组事情。")}</p><div className="space-card-footer"><span>{countText(item.board_count, 'boards')}</span><div><Button size="sm" onClick={() => { void useStore.getState().switchWorkspace(item.id); useStore.getState().setPage('boards') }}>{t("进入")}</Button>{item.can_manage && <Button size="sm" onClick={() => { setFormError(''); setSpace(item) }}>{t("编辑")}</Button>}{item.can_manage && item.id !== 1 && <Button size="sm" onClick={() => setRemove({ type: 'space', id: item.id, name: item.name })}>{t("删除")}</Button>}</div></div></article>)}</div> : <div className="member-list">{users.map(item => <article className="member-row" key={item.id}><span className="member-avatar" style={{ background: item.avatar_color }}>{item.display_name.slice(0, 1)}</span><div className="member-info"><h2>{item.display_name} <span>@{item.username}</span></h2><p>{item.role === 'admin' ? t("超级管理员 · 全部工作空间") : t(item.role === "member" ? "成员 · {0}" : "子管理员 · {0}", [item.disabled ? t("已停用") : t("使用中")])}</p><div className="member-spaces">{item.role === "member" && <span>{t("管理归属：{0}", [item.manager_name || t("超级管理员")])}</span>}{item.role !== 'admin' && (item.workspace_ids.length ? item.workspace_ids.map(id => <span key={id}>{spaces.find(w => w.id === id)?.name ?? t("其他已授权空间")}</span>) : <span>{t("未分配空间")}</span>)}</div></div>{item.role !== 'admin' && <div className="member-actions"><Button size="sm" onClick={() => { setFormError(''); setUser({ ...item, password: '' }) }}>{t("设置权限")}</Button><Button size="sm" onClick={() => setRemove({ type: 'user', id: item.id, name: item.display_name })}>{t("删除")}</Button></div>}</article>)}{!!users.length && <p className="management-note">{t("子管理员可创建空间并管理归属自己的成员；成员只能使用分配的空间。访客通过看板分享链接访问。")}</p>}</div>}
    <Modal open={!!space} title={space?.id ? t("编辑工作空间") : t("新建工作空间")} onClose={() => { if (!busy) setSpace(null) }} width={440}>{space && <form className="management-form" onSubmit={e => { e.preventDefault(); void saveSpace() }}><label>{t("空间名称")}<Input autoFocus required maxLength={60} value={space.name} onChange={e => setSpace({ ...space, name: e.target.value })} /></label><label>{t("简短描述")}<Input maxLength={240} value={space.description} onChange={e => setSpace({ ...space, description: e.target.value })} placeholder={t("例如：个人计划、团队项目")} /></label>{formError && <p role="alert" className="form-error">{formError}</p>}<div className="management-form-actions"><Button type="button" disabled={busy} onClick={() => setSpace(null)}>{t("取消")}</Button><Button type="submit" variant="primary" disabled={busy || !space.name.trim()}>{busy ? t("保存中…") : t("保存")}</Button></div></form>}</Modal>
    <Modal open={!!user} title={user?.id ? t("成员设置") : t("添加成员")} onClose={() => { if (!busy) setUser(null) }} width={480} footer={user && <div className="management-form-actions"><Button type="button" disabled={busy} onClick={() => setUser(null)}>{t("取消")}</Button><Button type="submit" data-member-save="true" form={userFormId} variant="primary" disabled={busy}>{busy ? t("保存中…") : t("保存")}</Button></div>}>{user && <form id={userFormId} className="management-form" onKeyDown={e => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault() }} onSubmit={e => { e.preventDefault(); if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-member-save") === "true") void saveUser() }}><div className="management-form-columns"><label>{t("登录名")}<Input autoFocus={!user.id} required disabled={!!user.id} autoComplete="off" maxLength={80} value={user.username} onChange={e => setUser({ ...user, username: e.target.value })} /></label><label>{t("显示名称")}<Input required maxLength={60} value={user.display_name} onChange={e => setUser({ ...user, display_name: e.target.value })} /></label></div><label>{user.id ? t("重置密码（留空不修改）") : t("初始密码")}<Input type="password" autoComplete="new-password" required={!user.id} minLength={8} maxLength={72} value={user.password} onChange={e => setUser({ ...user, password: e.target.value })} placeholder={t("至少 8 位，首次登录需修改")} /></label><label>{t("角色")}<Select label={t("角色")} value={user.role === "member" ? 0 : 1} disabled={!isAdmin} options={[{value:0,label:t("成员")},...(isAdmin ? [{value:1,label:t("子管理员")}] : [])]} onChange={value=>setUser({...user,role:value===0?"member":"workspace_admin"})}/></label><p className="management-note">{t(user.role === "workspace_admin" ? "子管理员可以创建和管理自己的空间，以及归属自己的成员；不能管理其他子管理员或他人的成员。" : "成员可操作分配空间内的看板、卡片和分享，不能创建或管理空间及人员。")}</p>{isAdmin && user.role === "member" && <label>{t("归属子管理员")}<Select label={t("归属子管理员")} value={user.manager_id ?? 0} options={[{value:0,label:t("由超级管理员管理")},...users.filter(item=>item.role === "workspace_admin" && (!item.disabled || item.id === user.manager_id)).map(item=>({value:item.id,label:`${item.display_name} (@${item.username})`}))]} onChange={value=>setUser({...user,manager_id:value})}/><span className="management-note">{t("调整后原子管理员失去管理权限，新归属立即生效；已有空间访问权限保持不变。")}</span></label>}<fieldset><legend>{t("可以使用的工作空间")}</legend><div className="workspace-checks">{spaces.filter(item=>isAdmin || item.can_manage).map(item => <label key={item.id}><input type="checkbox" checked={user.workspace_ids.includes(item.id)} onChange={e => setUser({ ...user, workspace_ids: e.target.checked ? [...user.workspace_ids, item.id] : user.workspace_ids.filter(id => id !== item.id) })} /><span>{workspaceName(item)}</span></label>)}</div><p className="management-note">{t("可分配多个空间；改为成员后，仅保留勾选空间的访问权限。")}</p></fieldset><label className="management-toggle"><input type="checkbox" checked={user.disabled} onChange={e => setUser({ ...user, disabled: e.target.checked })} />{t("停用此账号")}</label>{user.id && <p className="management-note">{t("保存后该成员需重新登录，以应用最新权限。")}</p>}{formError && <p role="alert" className="form-error">{formError}</p>}</form>}</Modal>
    <ConfirmDialog open={!!remove} title={t("删除{0}", [remove?.type === 'space' ? t("工作空间") : t("成员")])} message={remove?.type === 'space' ? t("删除「{0}」？只有空空间才能删除，已有看板不会被连带删除。", [remove.name]) : t("删除「{0}」的账号？看板、卡片与历史记录会保留，该账号将无法登录。", [remove?.name])} onClose={() => setRemove(null)} onOK={async () => { if (!remove) return; if (remove.type === 'space') await api.deleteWorkspace(remove.id); else await api.deleteUser(remove.id); await refresh(); setRemove(null) }} />
  </section>
}
