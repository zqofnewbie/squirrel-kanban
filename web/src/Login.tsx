import { useState } from 'react'
import { useStore } from './store'
import { Button, Input } from './ui'

export default function Login() {
  const login = useStore((s) => s.login)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
    } catch (err: any) {
      setError(err?.message ?? '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-[15px] font-medium text-white">
            看
          </span>
          <span className="text-[17px] font-medium tracking-tight">看板</span>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-card dark:border-white/[0.1] dark:bg-[#232327]"
        >
          <h1 className="mb-1 text-[15px] font-medium">登录</h1>
          <p className="mb-5 text-[12px] opacity-55">账号由管理员创建，不开放注册</p>

          <label className="mb-1.5 block text-[12px] opacity-70">登录名</label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="admin"
            className="mb-3"
          />

          <label className="mb-1.5 block text-[12px] opacity-70">密码</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••"
          />

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={busy} className="mt-5 w-full">
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="text-[12px] opacity-50 hover:opacity-90"
          >
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </button>
        </div>
      </div>
    </div>
  )
}
