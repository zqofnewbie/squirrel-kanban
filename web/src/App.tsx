import { shortcut, primaryKey } from './shortcuts'
import { notify } from './notifications'
import { useLanguage } from './useLanguage'
import LanguageToggle from './LanguageToggle'
import { t, workspaceName, countText, preference, savePreference } from './i18n'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
const Administration = lazy(() => import('./Administration'))
import ThemeToggle from './ThemeToggle'
import BoardAppearance from './BoardAppearance'
import { boardBackground } from './backgrounds'
import BoardCanvas from './BoardCanvas'
import { boardColor } from './boardColors'
import WorkspaceSidebar from './WorkspaceSidebar'
import ArchivedBox from './ArchivedBox'
import Board from './Board'
import CardDrawer from './CardDrawer'
import CommandPalette from './CommandPalette'
import Login from './Login'
import ShareDialog from './ShareDialog'
const ShareCenter = lazy(() => import('./ShareCenter'))
import Icon from './Icon'
import { api } from './api'
import { useEventStream } from './sse'
import { useStore } from './store'
import { Avatar, Button, ConfirmDialog, Input, PasswordInput, Menu, MenuItem, MenuSep, Modal, PromptDialog, Toast, cx } from './ui'

export default function App() {
  const language = useLanguage()
  const page = useStore(s => s.page)
  const workspaces = useStore(s => s.workspaces)
  const workspaceId = useStore(s => s.workspaceId)
  const activeWorkspace = workspaces.find(w => w.id === workspaceId)
  useEffect(() => { setShareTarget(null); setNewBoardOpen(false); setDelBoardOpen(false); setRenaming(false) }, [workspaceId])
  const me = useStore((s) => s.me)
  const ready = useStore((s) => s.ready)
  const board = useStore((s) => s.board)
  const boards = useStore((s) => s.boards)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const setPalette = useStore((s) => s.setPalette)
  const setArchiveOpen = useStore((s) => s.setArchiveOpen)
  const logout = useStore((s) => s.logout)
  const openBoard = useStore((s) => s.openBoard)
  const createBoard = useStore((s) => s.createBoard)
  const removeBoard = useStore((s) => s.removeBoard)
  const patchBoard = useStore((s) => s.patchBoard)

  const error = useStore((s) => s.error)
  const loading = useStore((s) => s.loading)
  const [shareTarget,setShareTarget]=useState<{boardId?:number;shareId?:string}|null>(null)
  const [shareRevision, setShareRevision] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => preference('squirrel.sidebar.collapsed') === 'true')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwd, setPwd] = useState({ old: '', next: '' })
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [delBoardOpen, setDelBoardOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  useEffect(() => setAppearanceOpen(false), [board?.id, page])
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEventStream(board?.id)
  function toggleSidebar() {
    if (window.innerWidth <= 760) { setSidebarOpen(v => !v); return }
    setSidebarCollapsed(v => { savePreference('squirrel.sidebar.collapsed', String(!v)); return !v })
  }

  useEffect(() => { document.title = page === 'administration' ? t("空间与成员 · 松鼠看板") : page === 'shares' ? t("分享管理 · 松鼠看板") : board ? t("{0} · 松鼠看板", [board.name]) : t("松鼠看板") }, [board?.name, page, language])

  useEffect(() => {
    if (me?.must_change_password) setPwdOpen(true)
  }, [me?.must_change_password])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (!typing && !e.isComposing && !e.altKey && !e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !document.querySelector('[role="dialog"]')) { e.preventDefault(); if (!e.repeat) toggleSidebar(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!document.querySelector('[role="dialog"]')) setPalette(true)
        return
      }
      if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') || useStore.getState().openCardId || useStore.getState().paletteOpen) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key.toLowerCase() === 'n' && !e.repeat && board && page === 'boards') {
        e.preventDefault()
        const hoveredColumn = document.querySelector<HTMLElement>('.board-content .board-canvas [data-column-id]:hover')
        const hoveredId = Number(hoveredColumn?.dataset.columnId)
        const col = board.columns.find(column => column.id === hoveredId) ?? board.columns[0]
        if (col) window.dispatchEvent(new CustomEvent('kanban:compose', { detail: col.id }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, page, setPalette])

  function flash(msg: string, kind: 'success' | 'error' = 'error') {
    notify(msg, kind)
  }

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-[13px] opacity-40">
        <span>{t("加载中…")}</span>
      </div>
    )
  }
  if (!me) return <Login />

  async function submitPassword() {
    if (pwd.next.length < 8) return flash(t("新密码至少 8 位"))
    try {
      await api.changePassword(pwd.old, pwd.next)
      useStore.getState().setMe({ ...me!, must_change_password: false })
      setPwdOpen(false)
      setPwd({ old: '', next: '' })
      flash(t("密码已更新"), 'success')
    } catch (e: any) {
      flash(e?.message ?? t("修改失败"))
    }
  }

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        onToggle={toggleSidebar}
        collapsed={sidebarCollapsed}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreate={() => { setSidebarOpen(false); setNewBoardOpen(true) }}
        onHelp={() => { setSidebarOpen(false); setHelpOpen(true) }}
      />
      <div className="workspace-main">
        <button className="desktop-nav-toggle sidebar-edge-toggle" title={`${sidebarCollapsed ? t('展开侧栏') : t('折叠侧栏')} (${shortcut('B')})`} aria-label={sidebarCollapsed ? t('展开侧栏') : t('折叠侧栏')} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}><Icon name={sidebarCollapsed ? 'panelOpen' : 'panelClose'} size={14} /></button>
      <header className="app-header">
        <button className="mobile-nav-toggle" aria-label={t("打开导航")} onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
        <Menu className="header-workspace-menu" align="left" width={250} trigger={(_open, toggle) => <button className="workspace-switcher" aria-label={t("切换工作空间")} onClick={toggle}><span>{activeWorkspace ? workspaceName(activeWorkspace) : t("工作空间")}</span><Icon name="chevron" size={13} /></button>}>{close => <>{workspaces.map(item => <MenuItem key={item.id} onClick={() => { close(); void useStore.getState().switchWorkspace(item.id) }}><span className="truncate">{workspaceName(item)}</span>{item.id === workspaceId && <Icon name="check" size={14} />}</MenuItem>)}{<><MenuSep /><MenuItem onClick={() => { close(); useStore.getState().setPage('administration') }}><Icon name="settings" size={15} />{t(me.role === "member" ? "工作空间" : "管理空间与成员")}</MenuItem></>}</>}</Menu><span className="header-workspace">/</span>

        {page === 'administration' ? <span className="text-[14px] font-medium">{me.role !== 'member' ? t("空间与成员") : t("工作空间")}</span> : page === 'shares' ? <span className="text-[14px] font-medium">{t("分享管理")}</span> : <Menu
          className="header-board-menu"
          align="left"
          width={260}
          trigger={(open, toggle) => (
            <button
              onClick={toggle}
              className={cx(
                'flex max-w-[260px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13.5px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
                open && 'bg-black/[0.05] dark:bg-white/[0.08]',
              )}
            >
              <span className="truncate">{board?.name ?? t("选择看板")}</span>
              <Icon name="chevron" size={14} className="opacity-50" />
            </button>
          )}
        >
          {(close) => (
            <>
              {boards.map((b) => (
                <MenuItem
                  key={b.id}
                  onClick={() => {
                    close()
                    void openBoard(b.id)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: boardColor(b.id) }} />
                    <span className="truncate">{b.name}</span>
                    {b.id === board?.id && <span className="ml-auto opacity-45">{t("当前")}</span>}
                  </span>
                </MenuItem>
              ))}
              <MenuSep />
              <MenuItem
                onClick={() => {
                  close()
                  setNewBoardOpen(true)
                }}
              >
                <Icon name="plus" size={16} />{t("新建看板")} </MenuItem>
              {board && (
                <>
                  <MenuItem
                    onClick={() => {
                      close()
                      setNameDraft(board.name)
                      setRenaming(true)
                    }}
                  >
                    {t("重命名当前看板")} </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close()
                      setArchiveOpen(true)
                    }}
                  >
                    {t("查看归档卡片")} </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close()
                      setDelBoardOpen(true)
                    }}
                  >
                    {t("删除当前看板")} </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>}

        {board && (
          <Modal open={renaming} onClose={() => setRenaming(false)} title={t("重命名看板")}>
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setRenaming(false)}>{t("取消")}</Button>
              <Button
                variant="primary"
                disabled={!nameDraft.trim()}
                onClick={async () => {
                  try { await patchBoard({ name: nameDraft.trim() }); setRenaming(false) } catch {}
                }}
              >
                {t("保存")} </Button>
            </div>
          </Modal>
        )}

        <div className="mx-2 hidden h-5 w-px bg-black/[0.1] dark:bg-white/[0.12] sm:block" />

        <div className={`header-filter relative ${page !== 'boards' ? 'hidden' : ''}`}>
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("筛选当前看板…")}
            aria-label={t("筛选卡片")}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
            className="h-8 w-[180px] pl-8 text-[12.5px]"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] opacity-35">
            <Icon name="search" size={15} />
          </span>
        </div>

        <div className="header-account ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setPalette(true)}
            className="hidden h-8 rounded-lg px-2.5 text-[12.5px] opacity-55 hover:bg-black/[0.05] hover:opacity-100 dark:hover:bg-white/[0.08] md:block"
            title={`${t("搜索")} (${shortcut("K")})`}
          >
            {t("搜索")} </button>
          <LanguageToggle /><ThemeToggle />

          <Menu
            width={190}
            trigger={(_, toggle) => (
              <button aria-label={t("账号菜单")} onClick={toggle} className="rounded-full">
                <Avatar user={me} size={30} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="px-3 py-2">
                  <div className="truncate text-[13px] font-medium">{me.display_name}</div>
                  <div className="truncate text-[11.5px] opacity-45">
                    @{me.username} · {me.role === 'admin' ? t("超级管理员") : me.role === 'member' ? t("成员") : t("子管理员")}
                  </div>
                </div>
                <MenuSep />
                <MenuItem onClick={() => { close(); setProfileOpen(true) }}>{t("账号设置")}</MenuItem>
                <MenuItem
                  onClick={() => {
                    close()
                    setPwdOpen(true)
                  }}
                >
                  {t("修改密码")} </MenuItem>
                <MenuSep />
                <MenuItem
                  danger
                  onClick={() => {
                    close()
                    void logout()
                  }}
                >
                  {t("退出登录")} </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      <main
        className="board-main relative min-h-0 flex-1 overflow-hidden"
        style={page === 'boards' && board ? boardBackground(board.background, board.id) : undefined}
      >
        {page === 'boards' && board && <div className="board-background-shade" aria-hidden />}
        {page === 'administration' ? <Suspense fallback={<p role="status" className="p-6">{t('正在加载…')}</p>}><Administration /></Suspense> : page === 'shares' ? <Suspense fallback={<p role="status" className="p-6">{t('正在加载…')}</p>}><ShareCenter key={workspaceId} revision={shareRevision} onConfigure={shareId=>setShareTarget({shareId})} onCreate={()=>setShareTarget({})} /></Suspense> : board ? (
          <div className="board-content">
            <div className="board-toolbar">
              <div className="board-heading"><h1 title={board.name}>{board.name}</h1><p title={board.description || t("理清思路，让每一件事都有进展。")}>{board.description || t("理清思路，让每一件事都有进展。")}</p></div>
              <div className="board-toolbar-actions"><Button aria-label={t("看板外观")} onClick={() => setAppearanceOpen(true)}><Icon name="settings" size={16} />{t("外观")}</Button><Button onClick={() => setShareTarget({boardId:board.id})}><Icon name="share" size={16} />{t("分享")}</Button><button className="toolbar-secondary" onClick={() => setArchiveOpen(true)}><Icon name="archive" size={16} />{t("归档箱")}</button></div>
            </div>
            <div className="board-viewbar"><span className="active-view"><Icon name="board" size={16} />{t("看板视图")}</span><span>{countText(board.columns.length, 'lists')} · {countText(board.columns.reduce((n,c)=>n+c.cards.length,0), 'cards')}</span>{search && <button onClick={() => setSearch('')}>{t("清除筛选")}<Icon name="close" size={13} /></button>}<button className="board-help" onClick={() => setHelpOpen(true)}>{t("拖动卡片推进任务 · N 快速建卡")}</button></div>
            {loading && <div role="status" className="loading-bar">{t("正在切换看板…")}</div>}
            {error && <div role="alert" className="error-banner">{error}<button onClick={() => void openBoard(board.id)}>{t("重试")}</button></div>}
            <BoardCanvas key={board.id} board={board}>{(scale, height) => <Board zoom={scale} height={height} />}</BoardCanvas>
          </div>
        ) : (
          <div className="relative grid h-full place-items-center text-[13px]">
            {loading ? <p role="status" className="text-[var(--muted)]">{t("正在加载…")}</p> : error ? <div className="empty-workspace"><h2 role="alert">{error}</h2><Button onClick={() => void useStore.getState().loadWorkspaces()}>{t("重试")}</Button></div> : <div className="empty-workspace">
              <Icon name="empty" size={32} />
              <h2>{workspaceId ? t("从一块新看板开始") : t("未分配工作空间")}</h2>
              {!workspaceId && <p>{me?.role === "member" ? t("请联系管理员为你分配工作空间。") : t("创建自己的工作空间，或由超级管理员为你分配。")}</p>}
              {workspaceId ? <Button variant="primary" onClick={() => setNewBoardOpen(true)}>{t("新建看板")}</Button> : me?.role !== "member" && <Button variant="primary" onClick={() => useStore.getState().setPage('administration')}>{t("新建工作空间")}</Button>}
            </div>}
          </div>
        )}

        {page === 'boards' && <CardDrawer />}
      </main>
      </div>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t("用起来，很简单")}><div className="help-list"><p><kbd>{shortcut("B")}</kbd> {t("展开或折叠侧栏")}</p><p><kbd>N</kbd>  {t("在第一个列表快速添加卡片")}</p><p><kbd>/</kbd>  {t("筛选当前看板的标题、描述和标签")}</p><p><kbd>{shortcut("K")}</kbd>  {t("搜索看板与卡片")}</p><p><kbd>Esc</kbd>  {t("关闭弹层、取消编辑或清除筛选")}</p><p><kbd>{primaryKey} + {t("滚轮")}</kbd>  {t("缩放看板；双指滑动移动画布，双指捏合缩放。右下角可重置、移动画布和打开缩略图")}</p><p><kbd>{t("空格 + 拖动 / 鼠标中键")}</kbd>  {t("临时移动画布；")}<kbd>H</kbd>  {t("切换移动模式；")}<kbd>{t("Shift + 滚轮")}</kbd>  {t("横向移动")}</p><p><kbd>+ / -</kbd>  {t("缩放 ·")} <kbd>0</kbd>  {t("重置 ·")} <kbd>F</kbd>  {t("适应宽度 ·")} <kbd>M</kbd>  {t("开关缩略图")}</p><p>{t("聚焦画布或缩略图后，方向键移动视口。输入文字时不会触发画布快捷键。")}</p><p>{t("拖动卡片调整顺序或列表；拖动列表标题排序。")}</p><p>{t("点击卡片查看详情，点击卡片右上角的编辑按钮改标题。")}</p><p>{t("添加卡片时，Enter 添加并完成，Shift + Enter 换行。")}</p></div></Modal>

      {shareTarget !== null && <ShareDialog key={shareTarget.shareId ?? shareTarget.boardId ?? 'new'} {...shareTarget} onClose={() => setShareTarget(null)} onSaved={() => { setShareRevision(value => value + 1); void useStore.getState().loadBoards() }} />}
      {board && <BoardAppearance board={board} open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />}
      <CommandPalette />
      <ArchivedBox />

      <Modal
        open={pwdOpen && !!me}
        onClose={() => {
          if (!me.must_change_password) setPwdOpen(false)
        }}
        title={me.must_change_password ? t("请先修改密码") : t("修改密码")}
      >
        <Field label={t("当前密码")}>
          <PasswordInput aria-label={t("当前密码")} autoComplete="current-password" value={pwd.old} onChange={(e) => setPwd({ ...pwd, old: e.target.value })} autoFocus />
        </Field>
        <Field label={t("新密码（至少 8 位）")}>
          <PasswordInput aria-label={t("新密码（至少 8 位）")} autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          {!me.must_change_password && <Button onClick={() => setPwdOpen(false)}>{t("取消")}</Button>}
          <Button variant="primary" onClick={submitPassword}>
            {t("保存")} </Button>
        </div>
      </Modal>

      <PromptDialog open={profileOpen} title={t("账号设置")} label={t("显示名称")} initial={me.display_name} onClose={() => setProfileOpen(false)} onOK={async name => { const saved = await api.updateProfile(name, me.avatar_color); useStore.getState().setMe(saved) }} />

      <PromptDialog
        open={newBoardOpen}
        title={t("新建看板")}
        label={t("看板名称")}
        initial={t("新看板")}
        okText={t("创建")}
        onOK={async (name) => { const id = await createBoard(name); await openBoard(id) }}
        onClose={() => setNewBoardOpen(false)}
      />

      <ConfirmDialog
        open={delBoardOpen && !!board}
        danger
        title={t("删除看板")}
        message={t("删除看板「{0}」？其中的列表、卡片、附件都会一并删除，此操作不可恢复。", [board?.name])}
        okText={t("删除")}
        onOK={async () => { if (board) await removeBoard(board.id) }}
        onClose={() => setDelBoardOpen(false)}
      />


    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  useLanguage()
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-[12px] opacity-65">{label}</label>
      {children}
    </div>
  )
}
