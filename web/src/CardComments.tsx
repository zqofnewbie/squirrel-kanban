import { Empty } from './ui'
import { useLanguage } from './useLanguage'
import { locale, commentAuthor } from './i18n'
import { t } from './i18n'
import { useEffect, useState } from 'react'
import { useStore } from './store'
import { api } from './api'
import { shareApi } from './shareApi'
import type { CardComment } from './shareApi'
import { Button, ConfirmDialog, Input, Textarea } from './ui'

export default function CardComments({ cardId, shareId, canComment = true }: { cardId: number; shareId?: string; canComment?: boolean }) {
  useLanguage()
  const [comments, setComments] = useState<CardComment[]>([])
  const [content, setContent] = useState('')
  const [author, setAuthor] = useState(() => sessionStorage.getItem('squirrel.visitor.name') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.hidden) return
      try { const rows = await shareApi.comments(cardId, shareId); if (alive) { setComments(rows); setError('') } } catch (e: any) { if (alive) setError(e.message) }
    }
    void load()
    const timer = window.setInterval(load, 15000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [cardId, shareId])
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (busy || !content.trim()) return
    setBusy(true); setError('')
    try {
      const rows = await shareApi.comment(cardId, content, author, shareId)
      setComments(rows); if (!shareId) void api.getCard(cardId).then(useStore.getState().updateCardLocal).catch(() => {}); setContent(''); if (shareId) sessionStorage.setItem('squirrel.visitor.name', author)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return <section className="mb-5">
    <h4 className="mb-3 text-[12px] font-medium text-[var(--muted)]">{t("评论")}</h4>
    {canComment && <form onSubmit={send} className="mb-4">
      {shareId && <Input aria-label={t("访客昵称")} maxLength={30} value={author} onChange={e => setAuthor(e.target.value)} placeholder={t("昵称（可选，显示为访客）")} className="mb-2" />}
      <Textarea aria-label={t("评论内容")} rows={3} maxLength={3000} value={content} onChange={e => setContent(e.target.value)} placeholder={t("留下你的想法…")} />
      <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" type="submit" disabled={busy || !content.trim()}>{busy ? t("发送中…") : t("发表评论")}</Button></div>
    </form>}
    {error && <p role="alert" className="mb-2 text-[12px] text-red-600">{error}</p>}
    {!comments.length && !error && <Empty compact text={t("还没有评论")} />}
    <ul className="space-y-3">{comments.map(c => <li key={c.id} className="rounded-lg border border-[var(--line)] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--muted)]"><span>{commentAuthor(c.author)}</span><time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString(locale())}</time>{!shareId && <button className="ml-auto hover:text-red-600" onClick={() => setDeleting(c.id)}>{t("删除")}</button>}</div>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{c.content}</p>
    </li>)}</ul>
    <ConfirmDialog open={deleting !== null} title={t("删除评论")} danger message={t("删除这条评论？此操作不可恢复。")} onClose={() => setDeleting(null)} onOK={async () => { if (deleting !== null) { await shareApi.deleteComment(deleting); if (!shareId) void api.getCard(cardId).then(useStore.getState().updateCardLocal).catch(() => {}); setComments(rows => rows.filter(c => c.id !== deleting)) } }} />
  </section>
}
