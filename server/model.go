package main

// ---------- 用户 ----------

type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Role         string `json:"role"`
	AvatarColor  string `json:"avatar_color"`
	Disabled     bool   `json:"disabled"`
	MustChange   bool   `json:"must_change_password"`
	CreatedAt    string `json:"created_at"`
	LastLoginAt  string `json:"last_login_at,omitempty"`
	SessionCount int    `json:"session_count,omitempty"`
}

type Me struct {
	User
	Actor     string `json:"actor"`
	CSRFToken string `json:"-"`
}

// ---------- 看板 ----------

type Board struct {
	WorkspaceID int64  `json:"workspace_id"`
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Background  string `json:"background"`
	Archived    bool   `json:"archived"`
	ShareCount  int    `json:"share_count"`
	CardCount   int    `json:"card_count"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type Column struct {
	ID       int64   `json:"id"`
	BoardID  int64   `json:"board_id"`
	Name     string  `json:"name"`
	Color    string  `json:"color"`
	Position float64 `json:"position"`
	WipLimit int     `json:"wip_limit"`
}

type ColumnWithCards struct {
	Column
	Cards []Card `json:"cards"`
}

type Label struct {
	ID       int64   `json:"id"`
	BoardID  int64   `json:"board_id"`
	Name     string  `json:"name"`
	Color    string  `json:"color"`
	Position float64 `json:"position"`
}

type Checklist struct {
	ID       int64           `json:"id"`
	CardID   int64           `json:"card_id"`
	Title    string          `json:"title"`
	Position float64         `json:"position"`
	Items    []ChecklistItem `json:"items"`
}

type ChecklistItem struct {
	ID          int64   `json:"id"`
	ChecklistID int64   `json:"checklist_id"`
	Text        string  `json:"text"`
	Done        bool    `json:"done"`
	Position    float64 `json:"position"`
}

type Attachment struct {
	ID        int64  `json:"id"`
	CardID    int64  `json:"card_id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
}

type Card struct {
	ID          int64   `json:"id"`
	ColumnID    int64   `json:"column_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Position    float64 `json:"position"`
	DueDate     string  `json:"due_date,omitempty"`
	Pinned      bool    `json:"pinned"`
	Cover       string  `json:"cover,omitempty"`
	Archived    bool    `json:"archived"`
	CreatedBy   int64   `json:"created_by,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`

	Labels      []Label      `json:"labels"`
	Checklists  []Checklist  `json:"checklists,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`

	ChecklistDone   int `json:"checklist_done"`
	ChecklistTotal  int `json:"checklist_total"`
	AttachmentCount int `json:"attachment_count"`
	CommentCount    int `json:"comment_count"`
}

type BoardDetail struct {
	Board
	Columns []ColumnWithCards `json:"columns"`
	Labels  []Label           `json:"labels"`
}

type Activity struct {
	ID        int64  `json:"id"`
	BoardID   int64  `json:"board_id"`
	CardID    int64  `json:"card_id,omitempty"`
	UserID    int64  `json:"user_id,omitempty"`
	Username  string `json:"username"`
	Type      string `json:"type"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"created_at"`
}

// ---------- 实时事件 ----------

type Event struct {
	Type    string `json:"type"`
	BoardID int64  `json:"board_id"`
	Actor   string `json:"actor"`
	Payload any    `json:"payload,omitempty"`
}
