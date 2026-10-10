import { useEffect, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { Card } from './types'
import { Button, Empty, Modal } from './ui'

export default function ArchivedBox() {
  const open = useStore((s) => s.archiveOpen)
  const setOpen = useStore((s) => s.setArchiveOpen)
  const board = useStore((s) => s.board)
  const reloadBoard = useStore((s) => s.reloadBoard)
  const [cards, setCards] = useState<Card[]>([])

  useEffect(() => {
    if (!open || !board) return
    api
      .archivedCards(board.id)
      .then(setCards)
      .catch(() => setCards([]))
  }, [open, board])

  async function restore(c: Card) {
    await api.updateCard(c.id, { archived: false }).catch(() => {})
    setCards((list) => list.filter((x) => x.id !== c.id))
    void reloadBoard()
  }

  async function purge(c: Card) {
    await api.deleteCard(c.id).catch(() => {})
    setCards((list) => list.filter((x) => x.id !== c.id))
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="已归档的卡片" width={520}>
      {cards.length === 0 ? (
        <Empty text="归档箱是空的" />
      ) : (
        <ul className="scroll-thin max-h-[52vh] space-y-1 overflow-y-auto">
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
              <Button size="sm" onClick={() => restore(c)}>
                恢复
              </Button>
              <Button size="sm" variant="danger" onClick={() => purge(c)}>
                彻底删除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
