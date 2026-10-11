import { notify as globalNotice } from './notifications'
import { t, locale } from './i18n'
import type {
  Workspace,
  ManagedUser,
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

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const notify = (message: string) => { if (init?.method && init.method !== 'GET') globalNotice(message, 'error') }
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Accept-Language': locale(), ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    ...init,
  }).catch(() => {
    const message = t("连接失败，请检查网络后重试。")
    notify(message)
    throw new ApiError(0, message)
  })
  if (res.ok) {
    const method=init?.method
    if (!path.startsWith('/api/shares') && !path.startsWith('/api/auth')) {
      if (method==='DELETE') globalNotice(t("删除成功"))
      else if (method==='POST' && /\/archive$/.test(path)) globalNotice(t("已归档"))
      else if (method==='POST' && /\/(boards|columns|cards|workspaces|users)$/.test(path)) globalNotice(t("创建成功"))
      else if (method==='POST' && /\/(attachments|background)$/.test(path)) globalNotice(t("上传成功"))
      else if (method==='PATCH' && typeof init?.body==='string') {
        const value=JSON.parse(init.body)
        if (typeof value.archived==='boolean') globalNotice(value.archived?t("已归档"):t("已恢复"))
        else if (/\/(users|workspaces)\/\d+$/.test(path) || /^\/api\/shared\/[^/]+\/cards\/\d+$/.test(path)) globalNotice(t("保存成功"))
      }
    }
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      const message = t("服务响应格式不正确，请确认后端已更新并重试。")
      notify(message)
      throw new ApiError(502, message)
    }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login' && !path.startsWith('/api/shared/')) window.dispatchEvent(new Event('kanban:session-expired'))
    const message = typeof data === 'object' && data?.error ? t(data.error) : t("请求失败 ({0})", [res.status])
    notify(message)
    throw new ApiError(res.status, message)
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

  workspaces: () => req<Workspace[]>('/api/workspaces'),
  createWorkspace: (name: string, description: string) => req<Workspace>('/api/workspaces', { method: 'POST', body: body({ name, description }) }),
  updateWorkspace: (id: number, name: string, description: string) => req<Workspace>(`/api/workspaces/${id}`, { method: 'PATCH', body: body({ name, description }) }),
  deleteWorkspace: (id: number) => req<void>(`/api/workspaces/${id}`, { method: 'DELETE' }),
  users: () => req<ManagedUser[]>('/api/users'),
  saveUser: (id: number | undefined, values: { role: 'member' | 'workspace_admin' | 'admin'; username: string; display_name: string; password: string; disabled: boolean; workspace_ids: number[]; manager_id?: number }) => req<void>(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PATCH' : 'POST', body: body(values) }),
  deleteUser: (id: number) => req<void>(`/api/users/${id}`, { method: 'DELETE' }),

  // 看板
  reorderBoards: (workspace_id: number, ids: number[]) => req<void>('/api/board-order', { method: 'PUT', body: body({ workspace_id, ids }) }),
  listBoards: (workspaceId?: number) => req<Board[]>(`/api/boards${workspaceId ? `?workspace_id=${workspaceId}` : ''}`),
  createBoard: (name: string, workspace_id: number) => req<Board>('/api/boards', { method: 'POST', body: body({ name, workspace_id }) }),
  getBoard: (id: number) => req<BoardDetail>(`/api/boards/${id}`),
  uploadBackground: (id: number, file: File) => { const fd = new FormData(); fd.append('file', file); return req<Board>(`/api/boards/${id}/background`, { method: 'POST', body: fd }) },
  archivedCards: (id: number) => req<Card[]>(`/api/boards/${id}/archived`),
  updateBoard: (id: number, v: Record<string, unknown>) =>
    req<Board>(`/api/boards/${id}`, { method: 'PATCH', body: body(v) }),
  deleteBoard: (id: number) => req<void>(`/api/boards/${id}`, { method: 'DELETE' }),
  normalizeBoard: (id: number) => req<void>(`/api/boards/${id}/normalize`, { method: 'POST' }),

  // 列
  createColumn: (boardId: number, name: string) =>
    req<Column>(`/api/boards/${boardId}/columns`, { method: 'POST', body: body({ name }) }),
  updateColumn: (id: number, v: { name?: string; wip_limit?: number; color?: string }) =>
    req<Column>(`/api/columns/${id}`, { method: 'PATCH', body: body(v) }),
  moveColumn: (id: number, before_id: number) =>
    req<Column>(`/api/columns/${id}/move`, { method: 'POST', body: body({ before_id }) }),
  archiveColumn: (id: number) => req<void>(`/api/columns/${id}/archive`, { method: 'POST' }),
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
