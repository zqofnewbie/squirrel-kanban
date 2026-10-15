import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useEffect, useState } from 'react'
import type { Attachment } from './types'
import { Modal } from './ui'
import Icon from './Icon'

export function attachmentKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aiff', 'mid'].includes(ext)) return 'audio'
  if (
    [
      'txt',
      'md',
      'csv',
      'json',
      'log',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'css',
      'js',
      'ts',
      'py',
      'go',
      'sql',
    ].includes(ext)
  )
    return 'text'
  if (
    [
      'doc',
      'docx',
      'docm',
      'xls',
      'xlsx',
      'xlsm',
      'ppt',
      'pptx',
      'pptm',
      'pps',
      'ppsx',
      'odt',
      'ods',
      'odp',
      'rtf',
      'pages',
      'numbers',
      'key',
    ].includes(ext)
  )
    return 'office'
  return 'file'
}
export function previewURL(a: Attachment, shareId?: string) {
  const base = shareId
    ? `/api/shared/${shareId}/attachments/${a.id}?preview=1`
    : `/api/attachments/${a.id}/preview`
  return attachmentKind(a.name) === 'office' ? `${base}${shareId ? '&' : '?'}office=1` : base
}
export function fileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`
}
export function AttachmentThumbnail({
  attachment: a,
  shareId,
}: {
  attachment: Attachment
  shareId?: string
}) {
  useLanguage()
  const [failed, setFailed] = useState(false)
  const kind = attachmentKind(a.name)
  return (
    <span className="attachment-thumbnail">
      {kind === 'image' && !failed ? (
        <img src={previewURL(a, shareId)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>
          {kind === 'file' ? (
            <Icon name="attachment" size={20} />
          ) : kind === 'office' ? (
            a.name.split('.').pop()?.toUpperCase()
          ) : (
            kind.toUpperCase()
          )}
        </span>
      )}
    </span>
  )
}

export function AttachmentViewer({
  attachment: a,
  shareId,
  onClose,
}: {
  attachment: Attachment | null
  shareId?: string
  onClose: () => void
}) {
  useLanguage()
  const [text, setText] = useState('')
  const [failure, setFailure] = useState('')
  const [validated, setValidated] = useState<{
    url: string
    kind: ReturnType<typeof attachmentKind>
  } | null>(null)
  const url = a ? previewURL(a, shareId) : ''
  const kind = validated?.url === url ? validated.kind : null
  useEffect(() => {
    setText('')
    setFailure('')
    setValidated(null)
    if (!a) return
    const controller = new AbortController()
    const load = async () => {
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
      if (response.status === 415) {
        if (!controller.signal.aborted) setValidated({ url, kind: 'file' })
        return
      }
      if (!response.ok)
        throw new Error(
          response.status === 503
            ? t('文档预览尚未启用，请下载原文件查看')
            : response.status === 422
              ? t('无法预览此文档，请确认文件未损坏或加密')
              : response.status === 504
                ? t('文档预览超时，可重试或下载查看')
                : response.status === 429
                  ? t('文档预览正在忙，请稍后重试')
                  : response.status === 403
                    ? t('此分享已失效或未开放附件权限')
                    : response.status === 401
                      ? t('登录已过期，请重新登录')
                      : response.status === 404
                        ? t('附件已不存在')
                        : t('暂时无法预览，请下载查看'),
        )
      const mime = response.headers.get('Content-Type') ?? ''
      const actualKind = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('application/pdf')
          ? 'pdf'
          : mime.startsWith('audio/')
            ? 'audio'
            : mime.startsWith('video/')
              ? 'video'
              : mime.startsWith('text/')
                ? 'text'
                : mime.startsWith('application/ogg')
                  ? attachmentKind(a.name) === 'video'
                    ? 'video'
                    : 'audio'
                  : 'file'
      if (actualKind === 'text') {
        const body = await fetch(url, {
          signal: controller.signal,
          headers: { Range: 'bytes=0-131071' },
        })
        if (!body.ok) throw new Error(t('暂时无法读取内容，请重试或下载查看'))
        const value = await body.text()
        if (!controller.signal.aborted) setText(value)
      }
      if (!controller.signal.aborted) setValidated({ url, kind: actualKind })
    }
    void load().catch((e) => {
      if (!controller.signal.aborted) setFailure(e.message || t('无法读取附件，请稍后重试'))
    })
    return () => controller.abort()
  }, [a?.id, url])
  const failed = () => setFailure(t('浏览器无法预览此文件，请下载查看'))
  return (
    <Modal open={!!a} title={a?.name ?? t('附件预览')} onClose={onClose} width={900}>
      {a && (
        <>
          <div className="attachment-preview-toolbar">
            <span>{fileSize(a.size)}</span>
            <a href={a.path} download className="attachment-download">
              <Icon name="upload" size={14} className="rotate-180" />
              {t('下载原文件')}
            </a>
          </div>
          {failure ? (
            <p role="alert" className="attachment-fallback">
              {failure}
            </p>
          ) : !kind ? (
            <p role="status" className="attachment-fallback">
              {attachmentKind(a.name) === 'office'
                ? t('正在生成文档预览，首次打开可能需要片刻…')
                : t('正在读取附件…')}
            </p>
          ) : (
            <div className="attachment-preview">
              {kind === 'image' && (
                <img src={previewURL(a, shareId)} alt={a.name} onError={failed} />
              )}
              {kind === 'pdf' && (
                <iframe title={t('PDF 预览：{0}', [a.name])} src={previewURL(a, shareId)} />
              )}
              {kind === 'video' && (
                <video controls preload="metadata" src={previewURL(a, shareId)} onError={failed} />
              )}
              {kind === 'audio' && (
                <audio controls preload="metadata" src={previewURL(a, shareId)} onError={failed} />
              )}
              {kind === 'text' && (
                <>
                  <pre>{text}</pre>
                  {a.size > 131072 && (
                    <p className="text-xs text-[var(--muted)]">
                      {t('仅预览前 128 KB，下载可查看完整内容。')}
                    </p>
                  )}
                </>
              )}
              {kind === 'file' && (
                <div className="attachment-fallback">
                  <Icon name="attachment" size={32} />
                  <p>{t('此格式暂不支持直接预览')}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {t('下载原文件，用对应的软件打开。')}
                  </p>
                </div>
              )}
            </div>
          )}
          {kind === 'pdf' && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {t('若浏览器未显示 PDF，可')}{' '}
              <a
                className="text-[var(--accent)]"
                href={previewURL(a, shareId)}
                target="_blank"
                rel="noreferrer"
              >
                {t('在新窗口打开')}
              </a>{' '}
              {t('或下载原文件。')}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}

export default function AttachmentList({
  attachments,
  shareId,
  onDelete,
}: {
  attachments: Attachment[]
  shareId?: string
  onDelete?: (a: Attachment) => void
}) {
  useLanguage()
  const [selected, setSelected] = useState<Attachment | null>(null)
  return (
    <>
      <ul className="attachment-list">
        {attachments.map((a) => (
          <li key={a.id}>
            <button
              className="attachment-open"
              onClick={() => setSelected(a)}
              title={a.name}
              aria-label={t('预览附件：{0}', [a.name])}
            >
              <AttachmentThumbnail attachment={a} shareId={shareId} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{a.name}</span>
                <span className="text-[11px] text-[var(--muted)]">
                  {fileSize(a.size)} ·{' '}
                  {attachmentKind(a.name) === 'file' ? t('查看文件') : t('点击预览')}
                </span>
              </span>
            </button>
            <a
              href={a.path}
              download
              aria-label={t('下载附件：{0}', [a.name])}
              className="attachment-action"
              title={t('下载')}
            >
              <Icon name="upload" className="rotate-180" size={16} />
            </a>
            {onDelete && (
              <button
                aria-label={t('删除附件：{0}', [a.name])}
                title={t('删除')}
                className="attachment-action hover:!text-red-600"
                onClick={() => onDelete(a)}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <AttachmentViewer attachment={selected} shareId={shareId} onClose={() => setSelected(null)} />
    </>
  )
}
