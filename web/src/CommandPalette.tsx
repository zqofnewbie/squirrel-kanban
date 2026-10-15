import { Empty } from './ui'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { Modal, cx } from './ui'

export default function CommandPalette() {
  const language = useLanguage()
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPalette)
  const board = useStore((s) => s.board)
  const boards = useStore((s) => s.boards)
  const openBoard = useStore((s) => s.openBoard)
  const setOpenCard = useStore((s) => s.setOpenCard)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  type Item = { label: string; hint?: string; run: () => void }
  const items = useMemo<Item[]>(() => {
    const kw = q.trim().toLowerCase()
    const out: Item[] = []
    if (board) {
      board.columns.forEach((col) =>
        col.cards.forEach((c) => {
          if (kw && !c.title.toLowerCase().includes(kw)) return
          out.push({
            label: c.title,
            hint: col.name,
            run: () => setOpenCard(c.id),
          })
        }),
      )
    }
    boards.forEach((b) => {
      if (kw && !b.name.toLowerCase().includes(kw)) return
      out.push({ label: b.name, hint: t('切换看板'), run: () => void openBoard(b.id) })
    })
    return out.slice(0, 40)
  }, [q, board, boards, openBoard, setOpenCard, language])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    if (open) setQ('')
  }, [open])

  function choose(i: number) {
    const it = items[i]
    if (!it) return
    setOpen(false)
    it.run()
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('搜索卡片 / 跳转')} width={520}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((s) => Math.min(s + 1, items.length - 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((s) => Math.max(s - 1, 0))
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            choose(sel)
          }
        }}
        placeholder={t('输入卡片标题或看板名')}
        className="mb-2 h-10 w-full rounded-lg border border-black/[0.12] bg-white px-3 text-[13.5px] outline-none focus:border-brand-400 dark:border-white/[0.14] dark:bg-white/[0.06]"
      />
      <div className="scroll-thin max-h-[46vh] overflow-y-auto">
        {items.length === 0 && <Empty compact text={t('没有匹配项')} />}
        {items.map((it, i) => (
          <button
            key={i}
            onMouseEnter={() => setSel(i)}
            onClick={() => choose(i)}
            className={cx(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
              i === sel
                ? 'bg-brand-50 text-brand-800 dark:bg-brand-800/25 dark:text-brand-100'
                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
            )}
          >
            <span className="truncate">{it.label}</span>
            {it.hint && (
              <span className="ml-auto shrink-0 text-[11.5px] opacity-45">{it.hint}</span>
            )}
          </button>
        ))}
      </div>
    </Modal>
  )
}
