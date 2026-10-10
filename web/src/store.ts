import { create } from 'zustand'
import { api } from './api'
import type { Board, BoardDetail, Card, ColumnWithCards, ServerEvent, User } from './types'

export type Theme = 'light' | 'dark'

interface State {
  me: User | null
  actor: string
  ready: boolean
  theme: Theme

  boards: Board[]
  board: BoardDetail | null
  loading: boolean
  error: string | null

  openCardId: number | null
  search: string
  paletteOpen: boolean
  usersOpen: boolean
  boardPickerOpen: boolean
  archiveOpen: boolean

  setTheme: (t: Theme) => void
  bootstrap: () => Promise<void>
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
  setMe: (u: User | null) => void

  loadBoards: () => Promise<void>
  openBoard: (id: number) => Promise<void>
  reloadBoard: () => Promise<void>
  createBoard: (name: string) => Promise<number>
  patchBoard: (v: Record<string, unknown>) => Promise<void>
  removeBoard: (id: number) => Promise<void>

  applyEvent: (e: ServerEvent) => void

  // 本地（乐观）操作
  addCardLocal: (c: Card) => void
  updateCardLocal: (c: Card) => void
  removeCardLocal: (id: number) => void
  moveCardLocal: (cardId: number, toColumn: number, index: number) => void

  setOpenCard: (id: number | null) => void
  setSearch: (s: string) => void
  setPalette: (v: boolean) => void
  setUsersOpen: (v: boolean) => void
  setBoardPicker: (v: boolean) => void
  setArchiveOpen: (v: boolean) => void
}

const themeKey = 'kanban.theme'

function initialTheme(): Theme {
  const saved = localStorage.getItem(themeKey)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  localStorage.setItem(themeKey, t)
}

export const useStore = create<State>((set, get) => ({
  me: null,
  actor: '',
  ready: false,
  theme: initialTheme(),

  boards: [],
  board: null,
  loading: false,
  error: null,

  openCardId: null,
  search: '',
  paletteOpen: false,
  usersOpen: false,
  boardPickerOpen: false,
  archiveOpen: false,

  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
  },

  bootstrap: async () => {
    applyTheme(get().theme)
    try {
      const me = await api.me()
      const boards = await api.listBoards()
      set({ me: me.user, actor: me.actor, boards, ready: true })
      if (boards.length) await get().openBoard(boards[0].id)
      else {
        const id = await get().createBoard('我的第一个看板')
        await get().openBoard(id)
      }
    } catch {
      set({ ready: true, me: null })
    }
  },

  login: async (username, password) => {
    const r = await api.login(username, password)
    set({ me: r.user, actor: r.actor })
    const boards = await api.listBoards()
    set({ boards })
    if (boards.length) await get().openBoard(boards[0].id)
    else {
      const id = await get().createBoard('我的第一个看板')
      await get().openBoard(id)
    }
  },

  logout: async () => {
    await api.logout().catch(() => {})
    set({ me: null, actor: '', board: null, boards: [], openCardId: null })
  },

  setMe: (u) => set({ me: u }),

  loadBoards: async () => set({ boards: await api.listBoards() }),

  openBoard: async (id) => {
    set({ loading: true, error: null })
    try {
      const board = await api.getBoard(id)
      set({ board, loading: false, openCardId: null })
    } catch (e: any) {
      set({ loading: false, error: e?.message ?? '加载看板失败' })
    }
  },

  reloadBoard: async () => {
    const id = get().board?.id
    if (!id) return
    const board = await api.getBoard(id)
    set({ board })
  },

  createBoard: async (name) => {
    const b = await api.createBoard(name)
    set({ boards: [b, ...get().boards] })
    return b.id
  },

  patchBoard: async (v) => {
    const id = get().board?.id
    if (!id) return
    await api.updateBoard(id, v)
    await get().loadBoards()
    await get().reloadBoard()
  },

  removeBoard: async (id) => {
    await api.deleteBoard(id)
    const boards = get().boards.filter((b) => b.id !== id)
    set({ boards })
    if (get().board?.id === id) {
      if (boards.length) await get().openBoard(boards[0].id)
      else {
        const nid = await get().createBoard('我的第一个看板')
        await get().openBoard(nid)
      }
    }
  },

  applyEvent: (e) => {
    const state = get()
    if (e.actor && e.actor === state.actor) return // 忽略自己的回声
    const board = state.board
    if (!board) return

    // 看板列表变更
    if (e.type === 'board.list' || e.type === 'board.list.deleted') {
      void state.loadBoards()
      return
    }
    // 结构变更（列/标签）直接整体刷新，操作简单可靠
    if (e.type === 'board.structure') {
      void state.reloadBoard()
      return
    }
    if (e.type === 'board.updated') {
      set({ board: { ...board, ...(e.payload as Board) } })
      void state.loadBoards()
      return
    }
    if (e.board_id !== board.id) return
    if (e.type === 'card.created') {
      state.addCardLocal(e.payload as Card)
      return
    }
    if (e.type === 'card.updated' || e.type === 'card.moved') {
      state.updateCardLocal(e.payload as Card)
      return
    }
    if (e.type === 'card.deleted') {
      state.removeCardLocal((e.payload as { id: number }).id)
    }
  },

  addCardLocal: (c) =>
    set((s) => {
      if (!s.board) return s
      return {
        board: {
          ...s.board,
          columns: s.board.columns.map((col) => {
            if (col.id !== c.column_id) return col
            // 服务端把新卡片放到列首（position 最小），这里按 position 排序保证位置正确
            const cards = [...col.cards.filter((x) => x.id !== c.id), c].sort(
              (a, b) => a.position - b.position,
            )
            return { ...col, cards }
          }),
        },
      }
    }),

  updateCardLocal: (c) =>
    set((s) => {
      if (!s.board) return s
      // 已归档的卡片不再出现在看板上，等同于移除
      if (c.archived) {
        return {
          board: {
            ...s.board,
            columns: s.board.columns.map((col) => ({
              ...col,
              cards: col.cards.filter((x) => x.id !== c.id),
            })),
          },
        }
      }
      const columns = s.board.columns.map((col) => ({
        ...col,
        cards: col.cards.filter((x) => x.id !== c.id),
      }))
      const target = columns.find((col) => col.id === c.column_id)
      if (!target) return s
      target.cards = [...target.cards, c].sort((a, b) => a.position - b.position)
      return { board: { ...s.board, columns } }
    }),

  removeCardLocal: (id) =>
    set((s) => {
      if (!s.board) return s
      return {
        board: {
          ...s.board,
          columns: s.board.columns.map((col) => ({
            ...col,
            cards: col.cards.filter((x) => x.id !== id),
          })),
        },
      }
    }),

  moveCardLocal: (cardId, toColumn, index) =>
    set((s) => {
      if (!s.board) return s
      let moving: Card | undefined
      const columns: ColumnWithCards[] = s.board.columns.map((col) => {
        const found = col.cards.find((c) => c.id === cardId)
        if (found) moving = { ...found }
        return { ...col, cards: col.cards.filter((c) => c.id !== cardId) }
      })
      if (!moving) return s
      const target = columns.find((c) => c.id === toColumn)
      if (!target) return s
      const cards = [...target.cards]
      cards.splice(Math.max(0, Math.min(index, cards.length)), 0, { ...moving!, column_id: toColumn })
      target.cards = cards
      return { board: { ...s.board, columns } }
    }),

  setOpenCard: (id) => set({ openCardId: id }),
  setSearch: (s) => set({ search: s }),
  setPalette: (v) => set({ paletteOpen: v }),
  setUsersOpen: (v) => set({ usersOpen: v }),
  setBoardPicker: (v) => set({ boardPickerOpen: v }),
  setArchiveOpen: (v) => set({ archiveOpen: v }),
}))
