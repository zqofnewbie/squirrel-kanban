import { useEffect, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { User } from './types'
import { Avatar, Button, ConfirmDialog, Input, Modal, cx } from './ui'

export default function UsersPanel() {
  const me = useStore((s) => s.me)!
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [newPass, setNewPass] = useState('')
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'member' })
  const [error, setError] = useState('')
  const [delUser, setDelUser] = useState<User | null>(null)

  async function refresh() {
    setUsers(await api.listUsers().catch(() => []))
    setLoading(false)
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function create() {
    setError('')
    try {
      setUsers(await api.createUser({ ...form, display_name: form.display_name || form.username }))
      setCreating(false)
      setForm({ username: '', display_name: '', password: '', role: 'member' })
    } catch (e: any) {
      setError(e?.message ?? '创建失败')
    }
  }

  async function patch(u: User, v: Record<string, unknown>) {
    try {
      setUsers(await api.updateUser(u.id, v))
    } catch (e: any) {
      setError(e?.message ?? '操作失败')
    }
  }

  async function doRemove(u: User) {
    try {
      setUsers(await api.deleteUser(u.id))
    } catch (e: any) {
      setError(e?.message ?? '删除失败')
    }
  }

  async function submitReset() {
    if (!resetFor || newPass.length < 4) return
    await patch(resetFor, { password: newPass })
    setResetFor(null)
    setNewPass('')
  }

  return (
    <div className="mx-auto max-w-[880px] px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h2 className="text-[16px] font-medium">用户管理</h2>
          <p className="mt-0.5 text-[12.5px] opacity-50">
            账号只能由超级管理员创建，系统不开放注册。新建的账号首次登录会被要求修改密码。
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          ＋ 新建用户
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.1]">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-black/[0.03] text-left text-[12px] dark:bg-white/[0.05]">
              <th className="w-[34%] px-4 py-2.5 font-medium opacity-60">用户</th>
              <th className="w-[14%] px-4 py-2.5 font-medium opacity-60">角色</th>
              <th className="w-[18%] px-4 py-2.5 font-medium opacity-60">最近登录</th>
              <th className="w-[16%] px-4 py-2.5 font-medium opacity-60">状态</th>
              <th className="px-4 py-2.5 font-medium opacity-60">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[12.5px] opacity-40">
                  加载中…
                </td>
              </tr>
            )}
            {!loading &&
              users.map((u) => (
                <tr
                  key={u.id}
                  className={cx(
                    'border-t border-black/[0.06] text-[13px] dark:border-white/[0.07]',
                    u.disabled && 'opacity-45',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar user={u} size={30} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.display_name}</div>
                        <div className="truncate text-[12px] opacity-45">@{u.username}</div>
                      </div>
                      {u.id === me.id && (
                        <span className="shrink-0 rounded bg-brand-50 px-1.5 py-[1px] text-[11px] text-brand-600 dark:bg-brand-800/30 dark:text-brand-200">
                          我
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={(e) => patch(u, { role: e.target.value })}
                      className="h-7 rounded-md border border-black/[0.12] bg-white px-1.5 text-[12.5px] outline-none disabled:opacity-50 dark:border-white/[0.14] dark:bg-[#2A2A2E]"
                    >
                      <option value="member">普通成员</option>
                      <option value="admin">超级管理员</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] opacity-60">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未登录'}
                  </td>
                  <td className="px-4 py-2.5 text-[12px]">
                    {u.disabled ? (
                      <span className="rounded bg-red-50 px-1.5 py-[1px] text-red-600 dark:bg-red-950/40 dark:text-red-400">已停用</span>
                    ) : u.must_change_password ? (
                      <span className="rounded bg-amber-50 px-1.5 py-[1px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">待改密码</span>
                    ) : (
                      <span className="opacity-50">正常</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => setResetFor(u)}>
                        重置密码
                      </Button>
                      {u.id !== me.id && (
                        <Button size="sm" onClick={() => patch(u, { disabled: !u.disabled })}>
                          {u.disabled ? '启用' : '停用'}
                        </Button>
                      )}
                      {u.id !== me.id && (
                        <Button size="sm" variant="danger" onClick={() => setDelUser(u)}>
                          删除
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="新建用户">
        <Field label="登录名">
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="例如 lisi" autoFocus />
        </Field>
        <Field label="显示名称">
          <Input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder="留空则与登录名相同"
          />
        </Field>
        <Field label="初始密码">
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="至少 4 位"
          />
        </Field>
        <Field label="角色">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="h-9 w-full rounded-lg border border-black/[0.12] bg-white px-2 text-[13px] outline-none dark:border-white/[0.14] dark:bg-white/[0.06]"
          >
            <option value="member">普通成员</option>
            <option value="admin">超级管理员</option>
          </select>
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setCreating(false)}>取消</Button>
          <Button variant="primary" onClick={create} disabled={!form.username.trim() || form.password.length < 4}>
            创建
          </Button>
        </div>
      </Modal>

      <Modal open={!!resetFor} onClose={() => setResetFor(null)} title={`重置 ${resetFor?.display_name} 的密码`}>
        <p className="mb-3 text-[12.5px] opacity-55">重置后该用户下次登录会被要求修改密码。</p>
        <Input
          type="password"
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          placeholder="新密码，至少 4 位"
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setResetFor(null)}>取消</Button>
          <Button variant="primary" onClick={submitReset} disabled={newPass.length < 4}>
            确认重置
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!delUser}
        danger
        title="删除账号"
        message={`确定删除账号「${delUser?.username}」？该账号的会话会立即失效。`}
        okText="删除"
        onOK={() => delUser && void doRemove(delUser)}
        onClose={() => setDelUser(null)}
      />
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
