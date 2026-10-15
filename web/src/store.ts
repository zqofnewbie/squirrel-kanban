import { moveBoardCard } from './boardDrag'
import { preference, savePreference, themeKey, detectTheme } from './i18n'
import { t } from './i18n'
import { create } from 'zustand'
import { api } from './api'
import type { Board, BoardDetail, Card, ColumnWithCards, ServerEvent, User, Workspace } from './types'

export type CardSection = 'comments' | 'attachments'

export type Theme = 'light' | 'dark'

interface State {
  page: 'boards' | 'shares' | 'administration'
  setPage: (page: 'boards' | 'shares' | 'administration') => void
  me: User | null
  actor: string
  ready: boolean
  theme: Theme

  workspaces: Workspace[]
  workspaceId: number | null
  loadWorkspaces: () => Promise<void>
  switchWorkspace: (id: number) => Promise<void>
  boards: Board[]
  board: BoardDetail | null
  loading: boolean
  error: string | null

  openCardId: number | null
  openCardSection: CardSection | null
  search: string
  paletteOpen: boolean
  archiveOpen: boolean

  setTheme: (t: Theme) => void
  bootstrap: () => Promise<void>
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
  setMe: (u: User | null) => void
  expireSession: () => void

  loadBoards: () => Promise<void>
  openBoard: (id: number, navigate?: boolean) => Promise<void>
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

  setOpenCard: (id: number | null, section?: CardSection) => void
  setSearch: (s: string) => void
  setPalette: (v: boolean) => void
  setArchiveOpen: (v: boolean) => void
}

let boardRequest = 0
let reloadRequest = 0
let workspaceRequest = 0

function initialTheme(): Theme {
  const saved = preference(themeKey)
  return detectTheme(saved, matchMedia('(prefers-color-scheme: dark)').matches)
}
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useStore = create<State>((set, get) => ({
  page: 'boards',
  setPage: page => {
 const path = page === 'administration' ? '/administration' : page === 'shares' ? '/shares' : '/'
 if (location.pathname !== path) history.pushState(null,'',path)
 ++boardRequest
 set({page,openCardId:null,search:'',loading:false})
 },
  me: null,
  actor: '',
  ready: false,
  theme: initialTheme(),

  workspaces: [],
  workspaceId: null,
  boards: [],
  board: null,
  loading: false,
  error: null,

  openCardId: null,
  openCardSection: null,
  search: '',
  paletteOpen: false,
  archiveOpen: false,

  setTheme: (t) => {
    savePreference(themeKey, t)
    applyTheme(t)
    set({ theme: t })
  },

  bootstrap: async () => {
    applyTheme(get().theme)
    try {
      const me = await api.me()
      set({ me: me.user, actor: me.actor })
      await get().loadWorkspaces()
      set({ ready: true })
    } catch (error: any) {
      set({ ready: true, error: error?.message ?? t("加载失败，请重试") })
    }
  },

  login: async (username, password) => {
    const destination=location.pathname==='/administration'?'administration':location.pathname==='/shares'?'shares':'boards'
    const r = await api.login(username, password)
    set({ me: r.user, actor: r.actor, loading: true, error: null })
    await get().loadWorkspaces()
    get().setPage(destination)
  },

  logout: async () => {
    ++boardRequest
    await api.logout().catch(() => {})
    ++workspaceRequest
    set({ me: null, actor: '', board: null, boards: [], workspaces: [], workspaceId: null, openCardId: null, loading: false, error: null })
  },

  setMe: (u) => set({ me: u }),
  expireSession: () => {
    ++boardRequest; ++reloadRequest; ++workspaceRequest
    set({ me: null, actor: '', board: null, boards: [], workspaces: [], workspaceId: null, openCardId: null, archiveOpen: false, paletteOpen: false, loading: false, ready: true, error: null })
  },

  loadWorkspaces: async () => {
    set({ loading: true, error: null })
    try {
      const workspaces = await api.workspaces()
      set({ workspaces })
      const selected = get().workspaceId ?? Number(localStorage.getItem(`squirrel.workspace.${get().me?.id}`))
      const id = workspaces.find(w => w.id === selected)?.id ?? workspaces[0]?.id
      if (id) await get().switchWorkspace(id)
      else { ++boardRequest; ++workspaceRequest; set({ workspaceId: null, boards: [], board: null, openCardId: null, loading: false, error: null }) }
    } catch (e: any) {
      set({ loading: false, error: e?.message ?? t("加载失败，请重试") })
    }
  },
  switchWorkspace: async id => {
    const version = ++workspaceRequest
    ++boardRequest; ++reloadRequest
    set({ workspaceId: id, board: null, boards: [], openCardId: null, archiveOpen: false, search: '', loading: true, error: null })
    localStorage.setItem(`squirrel.workspace.${get().me?.id}`, String(id))
    try {
      const boards = await api.listBoards(id)
      if (version !== workspaceRequest) return
      set({ boards, loading: false })
      if (boards.length) await get().openBoard(boards.find(b => b.id === Number(localStorage.getItem('kanban.board')))?.id ?? boards[0].id, false)
    } catch (e: any) { if (version === workspaceRequest) set({ loading: false, error: e.message }) }
  },
  loadBoards: async () => {
    const id = get().workspaceId
    if (!id) return
    const boards = await api.listBoards(id)
    if (get().workspaceId === id) set({ boards })
  },

  openBoard: async (id, navigate = true) => {
    if (navigate) get().setPage('boards')
    set({ loading: true, error: null, search: '', openCardId: null })
    const request = ++boardRequest
    try {
      const board = await api.getBoard(id)
      if (request !== boardRequest) return
      localStorage.setItem('kanban.board', String(id))
      set({ board, loading: false, openCardId: null })
    } catch (e: any) {
      if (request !== boardRequest) return
      set({ loading: false, error: e?.message ?? t("加载看板失败") })
    }
  },

  reloadBoard: async () => {
    const id = get().board?.id
    if (!id) return
    const version=++reloadRequest
    try {
      const board = await api.getBoard(id)
      if (version===reloadRequest && get().board?.id === id) set({ board, error: null })
    } catch (e: any) { if (get().board?.id === id) set({ error: e?.message ?? t("刷新失败，请重试") }) }
  },

  createBoard: async (name) => {
    const workspaceId = get().workspaceId
    if (!workspaceId) throw new Error(t("请先选择工作空间"))
    const b = await api.createBoard(name, workspaceId)
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
      if (boards.length) await get().openBoard(boards.find(b => b.id === Number(localStorage.getItem('kanban.board')))?.id ?? boards[0].id)
      else set({ board: null, openCardId: null })
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
    if (e.board_id && e.board_id !== board.id) return
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
            // 新卡片追加到列尾；仍按固定优先、position 排序与服务端保持一致
            const cards = [...col.cards.filter((x) => x.id !== c.id), c].sort(
              (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.position - b.position,
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
      target.cards = [...target.cards, c].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.position - b.position)
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

  moveCardLocal: (cardId, toColumn, index) => set(s => s.board ? {board:moveBoardCard(s.board,cardId,toColumn,index)} : {}),

  setOpenCard: (id, section) => set({ openCardId: id, openCardSection: section ?? null }),
  setSearch: (s) => set({ search: s }),
  setPalette: (v) => set({ paletteOpen: v }),
  setArchiveOpen: (v) => set({ archiveOpen: v }),
}))


const systemTheme = matchMedia('(prefers-color-scheme: dark)')
systemTheme.addEventListener('change', event => {
 if (preference(themeKey)) return
 const theme = event.matches ? 'dark' : 'light'
 applyTheme(theme)
 useStore.setState({ theme })
})
