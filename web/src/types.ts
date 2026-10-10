export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'member'
  avatar_color: string
  disabled: boolean
  must_change_password: boolean
  created_at: string
  last_login_at?: string
  session_count?: number
}

export interface Board {
  id: number
  name: string
  description: string
  background: string
  archived: boolean
  card_count: number
  created_at: string
  updated_at: string
}

export interface Label {
  id: number
  board_id: number
  name: string
  color: string
  position: number
}

export interface ChecklistItem {
  id: number
  checklist_id: number
  text: string
  done: boolean
  position: number
}

export interface Checklist {
  id: number
  card_id: number
  title: string
  position: number
  items: ChecklistItem[]
}

export interface Attachment {
  id: number
  card_id: number
  name: string
  path: string
  size: number
  created_at: string
}

export interface Card {
  id: number
  column_id: number
  title: string
  description: string
  position: number
  due_date?: string
  cover?: string
  archived: boolean
  created_by?: number
  created_at: string
  updated_at: string
  labels: Label[]
  checklists?: Checklist[]
  attachments?: Attachment[]
  checklist_done: number
  checklist_total: number
  attachment_count: number
}

export interface Column {
  id: number
  board_id: number
  name: string
  position: number
  wip_limit: number
}

export interface ColumnWithCards extends Column {
  cards: Card[]
}

export interface BoardDetail extends Board {
  columns: ColumnWithCards[]
  labels: Label[]
}

export interface Activity {
  id: number
  board_id: number
  card_id?: number
  user_id?: number
  username: string
  type: string
  detail: string
  created_at: string
}

export interface ServerEvent {
  type: string
  board_id: number
  actor: string
  payload?: any
}
