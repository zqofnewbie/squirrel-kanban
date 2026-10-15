import { create } from 'zustand'
export type Notice = { id: number; message: string; kind: 'success' | 'error' | 'info' }
export const useNotices = create<{ items: Notice[] }>(() => ({ items: [] }))
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let serial = 0
export function dismissNotice(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  useNotices.setState((s) => ({ items: s.items.filter((item) => item.id !== id) }))
}
export function notify(message: string, kind: Notice['kind'] = 'success') {
  const existing = useNotices.getState().items.find((item) => item.message === message)
  if (existing) dismissNotice(existing.id)
  const id = ++serial
  const items = [...useNotices.getState().items, { id, message, kind }]
  while (items.length > 3) dismissNotice(items.shift()!.id)
  useNotices.setState({ items })
  timers.set(
    id,
    setTimeout(() => dismissNotice(id), kind === 'error' ? 7000 : 4000),
  )
}
