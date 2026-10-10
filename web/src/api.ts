import type {
  Activity,
  Attachment,
  Board,
  BoardDetail,
  Card,
  Checklist,
  ChecklistItem,
  Column,
  Label,
  User,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, typeof data === 'object' && data?.error ? data.error : `请求失败 (${res.status})`)
  }
  return data as T
}

const body = (v: unknown) => JSON.stringify(v)

export const api = {
  // 认证
  login: (username: string, password: string) =>
    req<{ user: User; actor: string }>('/api/auth/login', {
      method: 'POST',
      body: body({ username, password }),
    }),
  logout: () => req<void>('/api/auth/logout', { method: 'POST' }),
  me: () => req<{ user: User; actor: string }>('/api/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    req<void>('/api/auth/password', { method: 'PATCH', body: body({ old_password, new_password }) }),
  updateProfile: (display_name: string, avatar_color: string) =>
    req<User>('/api/auth/profile', { method: 'PATCH', body: body({ display_name, avatar_color }) }),

  // 用户
  listUsers: () => req<User[]>('/api/users'),
  createUser: (v: { username: string; display_name: string; password: string; role: string }) =>
    req<User[]>('/api/users', { method: 'POST', body: body(v) }),
  updateUser: (id: number, v: Record<string, unknown>) =>
    req<User[]>(`/api/users/${id}`, { method: 'PATCH', body: body(v) }),
  deleteUser: (id: number) => req<User[]>(`/api/users/${id}`, { method: 'DELETE' }),

  // 看板
  listBoards: () => req<Board[]>('/api/boards'),
  createBoard: (name: string) => req<Board>('/api/boards', { method: 'POST', body: body({ name }) }),
  getBoard: (id: number) => req<BoardDetail>(`/api/boards/${id}`),
  archivedCards: (id: number) => req<Card[]>(`/api/boards/${id}/archived`),
  updateBoard: (id: number, v: Record<string, unknown>) =>
    req<Board>(`/api/boards/${id}`, { method: 'PATCH', body: body(v) }),
  deleteBoard: (id: number) => req<void>(`/api/boards/${id}`, { method: 'DELETE' }),
  normalizeBoard: (id: number) => req<void>(`/api/boards/${id}/normalize`, { method: 'POST' }),

  // 列
  createColumn: (boardId: number, name: string) =>
    req<Column>(`/api/boards/${boardId}/columns`, { method: 'POST', body: body({ name }) }),
  updateColumn: (id: number, v: { name?: string; wip_limit?: number }) =>
    req<Column>(`/api/columns/${id}`, { method: 'PATCH', body: body(v) }),
  moveColumn: (id: number, before_id: number) =>
    req<Column>(`/api/columns/${id}/move`, { method: 'POST', body: body({ before_id }) }),
  deleteColumn: (id: number) => req<void>(`/api/columns/${id}`, { method: 'DELETE' }),

  // 卡片
  createCard: (columnId: number, title: string) =>
    req<Card>(`/api/columns/${columnId}/cards`, { method: 'POST', body: body({ title }) }),
  getCard: (id: number) => req<Card>(`/api/cards/${id}`),
  updateCard: (id: number, v: Record<string, unknown>) =>
    req<Card>(`/api/cards/${id}`, { method: 'PATCH', body: body(v) }),
  moveCard: (id: number, column_id: number, before_id: number) =>
    req<Card>(`/api/cards/${id}/move`, { method: 'POST', body: body({ column_id, before_id }) }),
  deleteCard: (id: number) => req<void>(`/api/cards/${id}`, { method: 'DELETE' }),
  setCardLabel: (cardId: number, label_id: number, on: boolean) =>
    req<Card>(`/api/cards/${cardId}/labels`, { method: 'POST', body: body({ label_id, on }) }),
  cardActivities: (id: number) => req<Activity[]>(`/api/cards/${id}/activities`),

  // 标签
  createLabel: (boardId: number, name: string, color: string) =>
    req<Label>(`/api/boards/${boardId}/labels`, { method: 'POST', body: body({ name, color }) }),
  updateLabel: (id: number, v: { name?: string; color?: string }) =>
    req<void>(`/api/labels/${id}`, { method: 'PATCH', body: body(v) }),
  deleteLabel: (id: number) => req<void>(`/api/labels/${id}`, { method: 'DELETE' }),

  // 清单
  createChecklist: (cardId: number, title: string) =>
    req<Checklist>(`/api/cards/${cardId}/checklists`, { method: 'POST', body: body({ title }) }),
  updateChecklist: (id: number, title: string) =>
    req<void>(`/api/checklists/${id}`, { method: 'PATCH', body: body({ title }) }),
  deleteChecklist: (id: number) => req<void>(`/api/checklists/${id}`, { method: 'DELETE' }),
  createItem: (listId: number, text: string) =>
    req<ChecklistItem>(`/api/checklists/${listId}/items`, { method: 'POST', body: body({ text }) }),
  updateItem: (id: number, v: { text?: string; done?: boolean }) =>
    req<void>(`/api/items/${id}`, { method: 'PATCH', body: body(v) }),
  deleteItem: (id: number) => req<void>(`/api/items/${id}`, { method: 'DELETE' }),

  // 附件
  uploadAttachment: (cardId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<Attachment>(`/api/cards/${cardId}/attachments`, { method: 'POST', body: fd })
  },
  deleteAttachment: (id: number) => req<void>(`/api/attachments/${id}`, { method: 'DELETE' }),
}
