import { useLanguage } from './useLanguage'
import ThemeToggle from './ThemeToggle'
import LanguageToggle from './LanguageToggle'
import { t } from './i18n'
import Brand from './Brand'
import { useState } from 'react'
import { useStore } from './store'
import { Button, Input } from './ui'

export default function Login() {
  useLanguage()
  const login = useStore((s) => s.login)
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
      setError(err?.message ?? t("登录失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page"><div className="login-preferences"><LanguageToggle /><ThemeToggle /></div>
      <div className="login-shell">
        <div className="login-brand"><Brand /></div>
        <div className="login-board-peek" aria-hidden="true"><span><i /><i /></span><span><i /></span><span><i /></span></div>

        <form
          onSubmit={submit}
          className="login-card"
        >
          <h1 className="login-heading">{t("欢迎回到松鼠看板")}</h1>
          <p className="login-description">{t("账号登录，访客请使用分享链接")}</p>

          <label htmlFor="login-username" className="mb-1.5 block text-[12px] opacity-70">{t("登录名")}</label>
          <Input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="admin"
            className="mb-3"
          />

          <label htmlFor="login-password" className="mb-1.5 block text-[12px] opacity-70">{t("密码")}</label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••"
          />

          {error && (
            <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={busy} className="login-submit mt-6 w-full">
            {busy ? t("登录中…") : t("登录")}
          </Button>
        </form>


      </div>
    </div>
  )
}
