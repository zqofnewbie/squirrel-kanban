import { useLanguage } from './useLanguage'
import { locale, commentAuthor } from './i18n'
import { t } from './i18n'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api'
import { shareApi, type CardComment } from './shareApi'
import type { Attachment, Card } from './types'
import type { CardSection } from './store'
import { AttachmentThumbnail, AttachmentViewer, attachmentKind, fileSize } from './Attachments'
import Icon from './Icon'
import { usePresence } from './usePresence'

export default function CardPeek({ card, kind, onOpen, shareId }: { card: Card; kind: CardSection; onOpen: (id: number, section?: CardSection) => void; shareId?: string }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [comments, setComments] = useState<CardComment[]>([])
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })
  const anchor = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const id = useId()
  const isFiles = kind === 'attachments'
  const count = isFiles ? card.attachment_count : card.comment_count
  const cancelClose = () => clearTimeout(timer.current)
  const show = () => { cancelClose(); setOpen(true) }
  const closeSoon = () => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 180) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true); setError('')
    const request = isFiles ? (shareId ? shareApi.card(shareId, card.id) : api.getCard(card.id)).then(c => { if (alive) setAttachments(c.attachments ?? []) }) : shareApi.comments(card.id, shareId).then(rows => { if (alive) setComments(rows) })
    request.catch(e => { if (alive) setError(e.message || t("读取失败，请点击查看详情")) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, isFiles, card.id, card.updated_at, count, shareId])
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popup.current) return
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect(), panel = popup.current!
      const top = rect.bottom + panel.offsetHeight + 10 <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - panel.offsetHeight - 8)
      setPosition({ left: Math.max(8, Math.min(rect.left - 12, window.innerWidth - panel.offsetWidth - 8)), top, ready: true })
    }
    place()
    const observer = new ResizeObserver(place); observer.observe(popup.current)
    const close = (event: Event) => { if (event.target instanceof Node && popup.current?.contains(event.target)) return; setOpen(false) }
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { observer.disconnect(); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])
  function navigate() { setOpen(false); onOpen(card.id, kind) }
  return <span className="card-peek-anchor" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <button ref={anchor} className="card-meta-button" aria-label={`${isFiles ? t("查看附件") : t("查看评论")}：${card.title}（${count}）`} aria-controls={open ? id : undefined} aria-expanded={open} onMouseEnter={show} onMouseLeave={closeSoon} onFocus={show} onBlur={e => { if (!popup.current?.contains(e.relatedTarget)) closeSoon() }} onKeyDown={e => { if (e.key === 'Escape') { cancelClose(); setOpen(false) } }} onClick={navigate}>
      <Icon name={isFiles ? 'attachment' : 'comment'} size={14} /><span>{count}</span>
    </button>
    {presence.mounted && createPortal(<div data-motion={presence.phase} aria-hidden={!open || undefined} {...(!open ? { inert: '' } : {})} ref={popup} id={id} role="region" aria-label={isFiles ? t("附件内容预览") : t("评论内容预览")} className="card-peek-panel motion-panel pop" style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }} onMouseEnter={cancelClose} onMouseLeave={closeSoon} onFocus={cancelClose} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== anchor.current) closeSoon() }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setOpen(false); anchor.current?.focus(); cancelClose(); setOpen(false) } }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <div className="card-peek-heading"><span>{isFiles ? t("附件") : t("最近评论")} <span className="text-[var(--muted)]">{count}</span></span><button onClick={navigate}>{t("查看全部")} <Icon name="external" size={12} /></button></div>
      {loading ? <p role="status" className="card-peek-message">{t("正在读取…")}</p> : error ? <p role="alert" className="card-peek-message">{error}</p> : isFiles ? <ul className="card-peek-files">{attachments.slice(0, 4).map(a => <li key={a.id}><button title={a.name} onClick={() => { setPreview(a); setOpen(false) }}><AttachmentThumbnail attachment={a} shareId={shareId} /><span className="min-w-0 flex-1"><span className="block truncate">{a.name}</span><span className="text-[11px] text-[var(--muted)]">{fileSize(a.size)} · {attachmentKind(a.name) === 'file' ? t("查看文件") : t("点击预览")}</span></span></button></li>)}</ul> : <ul className="card-peek-comments">{comments.slice(0, 3).map(c => <li key={c.id}><div><strong>{commentAuthor(c.author)}</strong><time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><p>{c.content}</p></li>)}</ul>}
      {!loading && !error && !(isFiles ? attachments.length : comments.length) && <p className="card-peek-message">{t("暂无")}{isFiles ? t("附件") : t("评论")}</p>}
    </div>, document.body)}
    <AttachmentViewer attachment={preview} shareId={shareId} onClose={() => setPreview(null)} />
  </span>
}
