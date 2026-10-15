import { useLanguage } from './useLanguage'
import { t } from './i18n'
import Icon from './Icon'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { Card } from './types'
import { Button, ConfirmDialog, Input, Modal, formatDate } from './ui'

export default function ArchivedBox() {
  useLanguage()
  const open = useStore((s) => s.archiveOpen)
  const setOpen = useStore((s) => s.setArchiveOpen)
  const board = useStore((s) => s.board)
  const reloadBoard = useStore((s) => s.reloadBoard)
  const [deleting, setDeleting] = useState<Card | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    if (!open || !board) return
    const version = ++request.current
    setFailure('')
    setLoading(true)
    api
      .archivedCards(board.id)
      .then((cards) => {
        if (version === request.current) setCards(cards)
      })
      .catch((e) => {
        if (version === request.current) setFailure(e.message)
      })
      .finally(() => {
        if (version === request.current) setLoading(false)
      })
    return () => {
      ++request.current
    }
  }, [open, board?.id, revision])
  useEffect(() => {
    setSearch('')
    setCards([])
    setDeleting(null)
  }, [open, board?.id])
  async function restore(c: Card) {
    if (busy !== null) return
    const version = request.current
    setBusy(c.id)
    setFailure('')
    try {
      await api.updateCard(c.id, { archived: false })
      if (version === request.current) setCards((list) => list.filter((x) => x.id !== c.id))
      await reloadBoard()
      await useStore.getState().loadBoards()
    } catch (e) {
      if (version === request.current) setFailure(e instanceof Error ? e.message : t('操作失败'))
    } finally {
      setBusy(null)
    }
  }
  const query = search.trim().toLocaleLowerCase()
  const filtered = cards.filter(
    (c) =>
      !query ||
      `${c.title} ${c.description} ${c.labels.map((l) => l.name).join(' ')}`
        .toLocaleLowerCase()
        .includes(query),
  )
  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (busy === null) setOpen(false)
        }}
        title={t('已归档的卡片')}
        width={660}
        footer={
          <div className="archive-footer">
            {!!cards.length && <span>{t('归档会保留内容，恢复后回到原列表。')}</span>}
            <Button size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>
              {t('关闭')}
            </Button>
          </div>
        }
      >
        <div className="archive-heading">
          <div>
            <strong>{board?.name}</strong>
            {!!cards.length && <p>{t('共 {0} 张归档卡片', [cards.length])}</p>}
          </div>
          <Button
            size="sm"
            disabled={loading || busy !== null}
            onClick={() => setRevision((v) => v + 1)}
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? t('正在加载…') : t('刷新')}
          </Button>
        </div>
        {!!cards.length && (
          <Input
            className="mb-4"
            aria-label={t('搜索归档卡片')}
            placeholder={t('搜索标题、描述或标签')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {failure && (
          <p role="alert" className="error-banner">
            {failure}
            <button onClick={() => setRevision((v) => v + 1)} disabled={loading}>
              {t('重试')}
            </button>
          </p>
        )}
        {loading ? (
          <p role="status" className="py-10 text-center text-sm text-[var(--muted)]">
            {t('正在加载…')}
          </p>
        ) : failure && !cards.length ? null : !filtered.length ? (
          <div className="archive-empty">
            <Icon name="empty" size={32} />
            <p>{cards.length ? t('没有匹配的卡片') : t('归档箱是空的')}</p>
            {!!cards.length && (
              <Button size="sm" onClick={() => setSearch('')}>
                {t('清除筛选')}
              </Button>
            )}
          </div>
        ) : (
          <ul className="archive-list">
            {filtered.map((c) => (
              <li key={c.id} className="archive-item">
                <div className="archive-item-content">
                  <h4>{c.title}</h4>
                  <p className="archive-meta">
                    {board?.columns.find((col) => col.id === c.column_id)?.name || t('原列表')}
                    <span> · {formatDate(c.updated_at)}</span>
                    {c.due_date && <span> · {t('截止 {0}', [formatDate(c.due_date)])}</span>}
                  </p>
                  {!!c.labels.length && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.labels.map((l) => (
                        <span
                          key={l.id}
                          className="colored-label rounded px-2 py-0.5 text-[11px]"
                          style={
                            {
                              background: l.color + '22',
                              '--label-color': l.color,
                            } as React.CSSProperties
                          }
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.description && (
                    <details className="archive-description">
                      <summary>{t('查看描述')}</summary>
                      <p>{c.description}</p>
                    </details>
                  )}
                </div>
                <div className="archive-item-actions">
                  <Button size="sm" disabled={busy !== null} onClick={() => void restore(c)}>
                    {busy === c.id ? t('恢复中…') : t('恢复')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    variant="danger"
                    onClick={() => setDeleting(c)}
                  >
                    {t('彻底删除')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title={t('彻底删除卡片')}
        danger
        message={t('删除「{0}」及其附件？此操作不可恢复。', [deleting?.title])}
        okText={t('彻底删除')}
        onOK={async () => {
          if (!deleting) return
          setBusy(deleting.id)
          try {
            await api.deleteCard(deleting.id)
            setCards((list) => list.filter((c) => c.id !== deleting.id))
          } finally {
            setBusy(null)
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
