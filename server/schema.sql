-- 用户与会话（账号只能由管理员创建，系统不提供注册入口）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  avatar_color  TEXT NOT NULL DEFAULT '#7F77DD',
  disabled      INTEGER NOT NULL DEFAULT 0,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 看板
CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  background  TEXT NOT NULL DEFAULT '#EEEDFE',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   REAL NOT NULL,
  wip_limit  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns(board_id, position);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  column_id   INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    REAL NOT NULL,
  due_date    TEXT,
  cover       TEXT NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
CREATE INDEX IF NOT EXISTS idx_cards_archived ON cards(archived);

CREATE TABLE IF NOT EXISTS labels (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name     TEXT NOT NULL DEFAULT '',
  color    TEXT NOT NULL DEFAULT '#7F77DD',
  position REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id, position);

CREATE TABLE IF NOT EXISTS card_labels (
  card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);

CREATE TABLE IF NOT EXISTS checklists (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title    TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklists_card ON checklists(card_id, position);

CREATE TABLE IF NOT EXISTS checklist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_checklist ON checklist_items(checklist_id, position);

CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL,
  card_id    INTEGER,
  user_id    INTEGER,
  username   TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_board ON activities(board_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_activities_card ON activities(card_id, id DESC);
