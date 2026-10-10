import { useEffect, useRef, useState } from 'react'
import ArchivedBox from './ArchivedBox'
import Board from './Board'
import CardDrawer from './CardDrawer'
import CommandPalette from './CommandPalette'
import Login from './Login'
import UsersPanel from './UsersPanel'
import { api } from './api'
import { useEventStream } from './sse'
import { useStore } from './store'
import { Avatar, Button, ConfirmDialog, Input, Menu, MenuItem, MenuSep, Modal, PromptDialog, Toast, cx } from './ui'

export default function App() {
  const me = useStore((s) => s.me)
  const ready = useStore((s) => s.ready)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const board = useStore((s) => s.board)
  const boards = useStore((s) => s.boards)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const setPalette = useStore((s) => s.setPalette)
  const boardPicker = useStore((s) => s.boardPickerOpen)
  const setBoardPicker = useStore((s) => s.setBoardPicker)
  const usersOpen = useStore((s) => s.usersOpen)
  const setUsersOpen = useStore((s) => s.setUsersOpen)
  const setArchiveOpen = useStore((s) => s.setArchiveOpen)
  const logout = useStore((s) => s.logout)
  const openBoard = useStore((s) => s.openBoard)
  const createBoard = useStore((s) => s.createBoard)
  const removeBoard = useStore((s) => s.removeBoard)
  const patchBoard = useStore((s) => s.patchBoard)

  const [toast, setToast] = useState<string | null>(null)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwd, setPwd] = useState({ old: '', next: '' })
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [delBoardOpen, setDelBoardOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEventStream(board?.id)

  useEffect(() => {
    if (me?.must_change_password) setPwdOpen(true)
  }, [me?.must_change_password])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(true)
        return
      }
      if (typing) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'n' && board) {
        e.preventDefault()
        // 快捷键建卡：直接在第一列顶部创建并打开详情，不需要弹窗输标题
        const col = board.columns[0]
        if (col) {
          api
            .createCard(col.id, '新卡片')
            .then((c) => {
              useStore.getState().addCardLocal(c)
              useStore.getState().setOpenCard(c.id)
            })
            .catch(() => {})
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, setPalette])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-[13px] opacity-40">
        <span>加载中…</span>
      </div>
    )
  }
  if (!me) return <Login />

  async function submitPassword() {
    if (pwd.next.length < 4) return flash('新密码至少 4 位')
    try {
      await api.changePassword(pwd.old, pwd.next)
      useStore.getState().setMe({ ...me!, must_change_password: false })
      setPwdOpen(false)
      setPwd({ old: '', next: '' })
      flash('密码已更新')
    } catch (e: any) {
      flash(e?.message ?? '修改失败')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-black/[0.07] px-4 dark:border-white/[0.08]">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-[12px] font-medium text-white">
          看
        </span>

        <Menu
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
              <span className="truncate">{board?.name ?? '选择看板'}</span>
              <span className="text-[10px] opacity-45">▾</span>
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: b.background }} />
                    <span className="truncate">{b.name}</span>
                    {b.id === board?.id && <span className="ml-auto opacity-45">当前</span>}
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
                ＋ 新建看板
              </MenuItem>
              {board && (
                <>
                  <MenuItem
                    onClick={() => {
                      close()
                      setNameDraft(board.name)
                      setRenaming(true)
                    }}
                  >
                    重命名当前看板
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close()
                      setArchiveOpen(true)
                    }}
                  >
                    查看归档卡片
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close()
                      setDelBoardOpen(true)
                    }}
                  >
                    删除当前看板
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>

        {renaming && board && (
          <Modal open onClose={() => setRenaming(false)} title="重命名看板">
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setRenaming(false)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => {
                  void patchBoard({ name: nameDraft.trim() })
                  setRenaming(false)
                }}
              >
                保存
              </Button>
            </div>
          </Modal>
        )}

        <div className="mx-2 hidden h-5 w-px bg-black/[0.1] dark:bg-white/[0.12] sm:block" />

        <div className="relative hidden sm:block">
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="筛选卡片  /"
            className="h-8 w-[180px] pl-8 text-[12.5px]"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] opacity-35">
            ⌕
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setPalette(true)}
            className="hidden h-8 rounded-lg px-2.5 text-[12.5px] opacity-55 hover:bg-black/[0.05] hover:opacity-100 dark:hover:bg-white/[0.08] md:block"
            title="搜索 (Ctrl/Cmd + K)"
          >
            搜索
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="grid h-8 w-8 place-items-center rounded-lg text-[13px] opacity-55 hover:bg-black/[0.05] hover:opacity-100 dark:hover:bg-white/[0.08]"
            title="切换主题"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <Menu
            width={190}
            trigger={(_, toggle) => (
              <button onClick={toggle} className="rounded-full">
                <Avatar user={me} size={30} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="px-3 py-2">
                  <div className="truncate text-[13px] font-medium">{me.display_name}</div>
                  <div className="truncate text-[11.5px] opacity-45">
                    @{me.username} · {me.role === 'admin' ? '超级管理员' : '成员'}
                  </div>
                </div>
                <MenuSep />
                {me.role === 'admin' && (
                  <MenuItem
                    onClick={() => {
                      close()
                      setUsersOpen(true)
                    }}
                  >
                    用户管理
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    close()
                    setPwdOpen(true)
                  }}
                >
                  修改密码
                </MenuItem>
                <MenuSep />
                <MenuItem
                  danger
                  onClick={() => {
                    close()
                    void logout()
                  }}
                >
                  退出登录
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      <main
        className="relative min-h-0 flex-1 overflow-hidden"
        style={board ? { background: board.background } : undefined}
      >
        {/* 白纱柔化层：内容包裹层（下方 relative）在其后绘制，因此不会被盖住 */}
        {board && <div className="pointer-events-none absolute inset-0 bg-white/70 dark:bg-[#1A1A1D]/88" aria-hidden />}

        {usersOpen ? (
          <div className="scroll-thin relative h-full overflow-y-auto">
            <div className="pt-2">
              <button
                onClick={() => setUsersOpen(false)}
                className="mx-6 mb-1 text-[12.5px] opacity-55 hover:opacity-100"
              >
                ← 返回看板
              </button>
            </div>
            <UsersPanel />
          </div>
        ) : board ? (
          <div className="relative h-full">
            <Board />
          </div>
        ) : (
          <div className="relative grid h-full place-items-center text-[13px] opacity-45">正在加载看板…</div>
        )}

        <CardDrawer />
      </main>

      <CommandPalette />
      <ArchivedBox />

      <Modal
        open={pwdOpen && !!me}
        onClose={() => {
          if (!me.must_change_password) setPwdOpen(false)
        }}
        title={me.must_change_password ? '请先修改密码' : '修改密码'}
      >
        <Field label="当前密码">
          <Input type="password" value={pwd.old} onChange={(e) => setPwd({ ...pwd, old: e.target.value })} autoFocus />
        </Field>
        <Field label="新密码（至少 4 位）">
          <Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          {!me.must_change_password && <Button onClick={() => setPwdOpen(false)}>取消</Button>}
          <Button variant="primary" onClick={submitPassword}>
            保存
          </Button>
        </div>
      </Modal>

      <PromptDialog
        open={newBoardOpen}
        title="新建看板"
        label="看板名称"
        initial="新看板"
        okText="创建"
        onOK={(name) => void createBoard(name).then((id) => openBoard(id))}
        onClose={() => setNewBoardOpen(false)}
      />

      <ConfirmDialog
        open={delBoardOpen && !!board}
        danger
        title="删除看板"
        message={`删除看板「${board?.name}」？其中的列表、卡片、附件都会一并删除，此操作不可恢复。`}
        okText="删除"
        onOK={() => board && void removeBoard(board.id)}
        onClose={() => setDelBoardOpen(false)}
      />

      <Toast msg={toast} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-[12px] opacity-65">{label}</label>
      {children}
    </div>
  )
}
