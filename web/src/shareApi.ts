import { t } from './i18n'
import { req } from './api'
import type { BoardDetail, Card } from './types'

export interface SharePermissions {
  pin: boolean
  cover: boolean
  download: boolean
  comment: boolean
  checklist: boolean
  move: boolean
  edit: boolean
  create: boolean
}
export interface BoardShare {
  id: string
  board_archived: boolean
  board_id: number
  name: string
  short_key?: string
  created_at: string
  key?: string
  enabled: boolean
  expires_at: string
  permissions: SharePermissions
}
export interface ShareEntry extends BoardShare {
  board_name: string
  active: boolean
  sessions: number
}
export interface CardComment {
  id: number
  card_id: number
  author: string
  content: string
  created_at: string
}
export const noPermissions: SharePermissions = {
  pin: false,
  cover: false,
  download: false,
  comment: false,
  checklist: false,
  move: false,
  edit: false,
  create: false,
}
const json = (method: string, value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
})
export const permissionNames: Record<keyof SharePermissions, string> = {
  get pin() {
    return t('固定卡片')
  },
  get cover() {
    return t('修改封面')
  },
  get download() {
    return t('预览与下载附件')
  },
  get comment() {
    return t('评论')
  },
  get checklist() {
    return t('勾选清单')
  },
  get move() {
    return t('移动卡片')
  },
  get edit() {
    return t('编辑内容')
  },
  get create() {
    return t('新建卡片')
  },
}
export function shareLink(share: BoardShare) {
  return share.short_key
    ? `${location.origin}/s/${share.short_key}`
    : share.id && share.key
      ? `${location.origin}/s/${share.id}#key=${share.key}`
      : ''
}
export const shareApi = {
  list: (workspaceId?: number) =>
    req<ShareEntry[]>(`/api/shares${workspaceId ? `?workspace_id=${workspaceId}` : ''}`),
  remove: (id: string) => req<void>(`/api/shares/${id}`, { method: 'DELETE' }),
  settings: (id: string) => req<BoardShare>(`/api/shares/${id}`),
  createRecord: (
    share: Pick<BoardShare, 'board_id' | 'name' | 'enabled' | 'expires_at' | 'permissions'>,
  ) => req<BoardShare>('/api/shares', json('POST', share)),
  save: (id: string, share: Pick<BoardShare, 'name' | 'enabled' | 'expires_at' | 'permissions'>) =>
    req<BoardShare>(`/api/shares/${id}`, json('PATCH', share)),
  session: (id: string, key: string) =>
    req<void>(`/api/shared/${id}/session`, json('POST', { key })),
  board: (id: string, version = '') =>
    req<
      | { version: string; unchanged: true }
      | { version: string; unchanged?: false; board: BoardDetail; permissions: SharePermissions }
    >(`/api/shared/${id}/board${version ? `?version=${encodeURIComponent(version)}` : ''}`),
  card: (id: string, card: number) => req<Card>(`/api/shared/${id}/cards/${card}`),
  edit: (
    id: string,
    card: number,
    value: {
      title?: string
      description?: string
      due_date?: string
      pinned?: boolean
      cover?: string
    },
  ) => req<Card>(`/api/shared/${id}/cards/${card}`, json('PATCH', value)),
  move: (id: string, card: number, column_id: number, before_id = 0) =>
    req<Card>(`/api/shared/${id}/cards/${card}/move`, json('POST', { column_id, before_id })),
  create: (id: string, column: number, title: string) =>
    req<Card>(`/api/shared/${id}/columns/${column}/cards`, json('POST', { title })),
  item: (id: string, item: number, done: boolean) =>
    req<void>(`/api/shared/${id}/items/${item}`, json('PATCH', { done })),
  comments: (card: number, sid?: string) =>
    req<CardComment[]>(
      sid ? `/api/shared/${sid}/cards/${card}/comments` : `/api/cards/${card}/comments`,
    ),
  comment: (card: number, content: string, author: string, sid?: string) =>
    req<CardComment[]>(
      sid ? `/api/shared/${sid}/cards/${card}/comments` : `/api/cards/${card}/comments`,
      json('POST', { content, author }),
    ),
  deleteComment: (id: number) => req<void>(`/api/comments/${id}`, { method: 'DELETE' }),
}
