package main

import (
	"errors"
	"strings"
)

var ErrNotFound = errors.New("记录不存在")

// ---------- 看板 ----------

func (s *Store) ListBoards() ([]Board, error) {
	rows, err := s.db.Query(
		`SELECT b.id, b.workspace_id, b.name, b.description, b.background, b.archived, b.created_at, b.updated_at,
		        (SELECT COUNT(*) FROM cards c
		           JOIN board_columns col ON col.id = c.column_id
		          WHERE col.board_id = b.id AND c.archived = 0) AS card_count,
 (SELECT COUNT(*) FROM board_shares sh WHERE sh.board_id=b.id AND sh.enabled=1 AND (sh.expires_at='' OR julianday(sh.expires_at)>julianday('now'))) AS share_count
		 FROM boards b WHERE b.archived = 0 ORDER BY b.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Board{}
	for rows.Next() {
		var b Board
		var arch int
		if err := rows.Scan(&b.ID, &b.WorkspaceID, &b.Name, &b.Description, &b.Background, &arch,
			&b.CreatedAt, &b.UpdatedAt, &b.CardCount, &b.ShareCount); err != nil {
			return nil, err
		}
		b.Archived = arch == 1
		out = append(out, b)
	}
	return out, nil
}

func (s *Store) CreateBoard(name, description, background string, workspaceIDs ...int64) (*Board, error) {
	workspaceID := int64(1)
	if len(workspaceIDs) > 0 {
		workspaceID = workspaceIDs[0]
	}
	return s.createBoardWithColumns(name, description, background, workspaceID, []string{"待办", "进行中", "已完成"})
}
func (s *Store) createBoardWithColumns(name, description, background string, workspaceID int64, cols []string) (*Board, error) {
	if strings.TrimSpace(name) == "" {
		name = "未命名看板"
	}
	if background == "" {
		background = "#F7F9FC"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := nowISO()
	res, err := tx.Exec(
		`INSERT INTO boards(name, description, background, created_at, updated_at, workspace_id)
		 VALUES(?,?,?,?,?,?)`, name, description, background, now, now, workspaceID)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	for i, c := range cols {
		if _, err := tx.Exec(
			`INSERT INTO board_columns(board_id, name, position, color) VALUES(?,?,?,?)`,
			id, c, float64((i+1)*1024), columnColors[i]); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetBoard(id)
}

func (s *Store) GetBoard(id int64) (*Board, error) {
	var b Board
	var arch int
	err := s.db.QueryRow(
		`SELECT id, workspace_id, name, description, background, archived, created_at, updated_at FROM boards WHERE id=?`, id).
		Scan(&b.ID, &b.WorkspaceID, &b.Name, &b.Description, &b.Background, &arch, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, ErrNotFound
	}
	b.Archived = arch == 1
	return &b, nil
}

// UpdateBoard applies all fields atomically; nil description means unchanged,
// while a pointer to an empty string explicitly clears it.
func (s *Store) UpdateBoard(id int64, name string, description *string, background string, archive *bool) error {
	_, err := s.db.Exec(`UPDATE boards SET
 name=COALESCE(NULLIF(?, ''), name), description=COALESCE(?, description),
 background=COALESCE(NULLIF(?, ''), background), archived=COALESCE(?, archived),
 updated_at=? WHERE id=?`, name, description, background, archive, nowISO(), id)
	return err
}

func (s *Store) DeleteBoard(id int64) error {
	_, err := s.db.Exec("DELETE FROM boards WHERE id=?", id)
	return err
}

func (s *Store) TouchBoard(id int64) {
	s.db.Exec("UPDATE boards SET updated_at=? WHERE id=?", nowISO(), id)
}

// GetBoardDetail 一次性返回看板、列、卡片、标签，前端首屏只需一次请求。
func (s *Store) GetBoardDetail(id int64) (*BoardDetail, error) {
	b, err := s.GetBoard(id)
	if err != nil {
		return nil, err
	}
	detail := &BoardDetail{Board: *b, Columns: []ColumnWithCards{}, Labels: []Label{}}

	labels, err := s.listLabels(id)
	if err != nil {
		return nil, err
	}
	detail.Labels = labels

	labelByCard, err := s.labelsByCard(id)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(
		`SELECT id, board_id, name, color, position, wip_limit FROM board_columns
		 WHERE board_id=? ORDER BY position, id`, id)
	if err != nil {
		return nil, err
	}
	colIDs := []int64{}
	cols := []ColumnWithCards{}
	for rows.Next() {
		var c Column
		if err := rows.Scan(&c.ID, &c.BoardID, &c.Name, &c.Color, &c.Position, &c.WipLimit); err != nil {
			rows.Close()
			return nil, err
		}
		colIDs = append(colIDs, c.ID)
		cols = append(cols, ColumnWithCards{Column: c, Cards: []Card{}})
	}
	rows.Close()

	cardRows, err := s.db.Query(
		`SELECT c.id, c.column_id, c.title, c.description, c.position,
		        COALESCE(c.due_date,''), c.cover, c.pinned, c.archived, COALESCE(c.created_by,0),
		        c.created_at, c.updated_at,
		        (SELECT COUNT(*) FROM checklist_items i JOIN checklists k ON k.id=i.checklist_id
		          WHERE k.card_id=c.id) AS total,
		        (SELECT COUNT(*) FROM checklist_items i JOIN checklists k ON k.id=i.checklist_id
		          WHERE k.card_id=c.id AND i.done=1) AS done,
		        (SELECT COUNT(*) FROM attachments a WHERE a.card_id=c.id) AS files,
 (SELECT COUNT(*) FROM card_comments m WHERE m.card_id=c.id) AS comments
		 FROM cards c
		 JOIN board_columns col ON col.id = c.column_id
		 WHERE col.board_id=? AND c.archived=0
		 ORDER BY c.pinned DESC, c.position, c.id`, id)
	if err != nil {
		return nil, err
	}
	defer cardRows.Close()
	byCol := map[int64][]Card{}
	for cardRows.Next() {
		var c Card
		var arch int
		if err := cardRows.Scan(&c.ID, &c.ColumnID, &c.Title, &c.Description, &c.Position,
			&c.DueDate, &c.Cover, &c.Pinned, &arch, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
			&c.ChecklistTotal, &c.ChecklistDone, &c.AttachmentCount, &c.CommentCount); err != nil {
			return nil, err
		}
		c.Archived = arch == 1
		if ls, ok := labelByCard[c.ID]; ok {
			c.Labels = ls
		} else {
			c.Labels = []Label{}
		}
		byCol[c.ColumnID] = append(byCol[c.ColumnID], c)
	}
	for i := range cols {
		if cards, ok := byCol[cols[i].ID]; ok {
			cols[i].Cards = cards
		}
	}
	detail.Columns = cols
	return detail, nil
}

// ListArchivedCards 返回已归档卡片，用于「归档箱」里的恢复与彻底删除。
func (s *Store) ListArchivedCards(boardID int64) ([]Card, error) {
	rows, err := s.db.Query(
		`SELECT c.id, c.column_id, c.title, c.description, c.position,
		        COALESCE(c.due_date,''), c.cover, c.pinned, c.created_at, c.updated_at
		 FROM cards c JOIN board_columns col ON col.id = c.column_id
		 WHERE col.board_id=? AND c.archived=1
		 ORDER BY c.updated_at DESC`, boardID)
	if err != nil {
		return nil, err
	}
	out := []Card{}
	for rows.Next() {
		var c Card
		if err := rows.Scan(&c.ID, &c.ColumnID, &c.Title, &c.Description, &c.Position,
			&c.DueDate, &c.Cover, &c.Pinned, &c.CreatedAt, &c.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		c.Archived = true
		out = append(out, c)
	}
	rows.Close() // 必须先关闭，再发起下一轮查询（单连接池下否则会死锁）

	for i := range out {
		out[i].Labels = s.cardLabels(out[i].ID)
	}
	return out, nil
}

func (s *Store) boardIDByColumn(colID int64) (int64, error) {
	var id int64
	err := s.db.QueryRow("SELECT board_id FROM board_columns WHERE id=?", colID).Scan(&id)
	return id, err
}

func (s *Store) boardIDByCard(cardID int64) (int64, error) {
	var id int64
	err := s.db.QueryRow(
		"SELECT col.board_id FROM cards c JOIN board_columns col ON col.id=c.column_id WHERE c.id=?",
		cardID).Scan(&id)
	return id, err
}

// ---------- 列 ----------

func (s *Store) CreateColumn(boardID int64, name string) (*Column, error) {
	if strings.TrimSpace(name) == "" {
		name = "新列表"
	}
	pos, err := s.nextPos("board_columns", "board_id", boardID, 0)
	if err != nil {
		return nil, err
	}
	count, err := s.queryInt("SELECT COUNT(*) FROM board_columns WHERE board_id=?", boardID)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		`INSERT INTO board_columns(board_id, name, position, color) VALUES(?,?,?,?)`, boardID, name, pos, columnColors[count%len(columnColors)])
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	s.TouchBoard(boardID)
	return s.GetColumn(id)
}

func (s *Store) GetColumn(id int64) (*Column, error) {
	var c Column
	err := s.db.QueryRow(
		`SELECT id, board_id, name, color, position, wip_limit FROM board_columns WHERE id=?`, id).
		Scan(&c.ID, &c.BoardID, &c.Name, &c.Color, &c.Position, &c.WipLimit)
	if err != nil {
		return nil, ErrNotFound
	}
	return &c, nil
}

func (s *Store) UpdateColumn(id int64, name string, wipLimit *int, color *string) error {
	col, err := s.GetColumn(id)
	if err != nil {
		return err
	}
	if name != "" {
		col.Name = name
	}
	if wipLimit != nil {
		col.WipLimit = *wipLimit
	}
	if color != nil {
		col.Color = *color
	}
	_, err = s.db.Exec("UPDATE board_columns SET name=?, wip_limit=?, color=? WHERE id=?", col.Name, col.WipLimit, col.Color, id)
	if err != nil {
		return err
	}
	s.TouchBoard(col.BoardID)
	return nil
}

func (s *Store) MoveColumn(id int64, beforeID int64) error {
	bid, err := s.boardIDByColumn(id)
	if err != nil {
		return ErrNotFound
	}
	if beforeID != 0 {
		other, e := s.boardIDByColumn(beforeID)
		if e != nil || other != bid {
			return errScope
		}
	}
	pos, err := s.nextPos("board_columns", "board_id", bid, beforeID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("UPDATE board_columns SET position=? WHERE id=?", pos, id)
	s.TouchBoard(bid)
	return err
}

// DeleteColumn 会一并删除列内卡片（外键 ON DELETE CASCADE）。
func (s *Store) DeleteColumn(id int64) error {
	bid, err := s.boardIDByColumn(id)
	if err != nil {
		return ErrNotFound
	}
	_, err = s.db.Exec("DELETE FROM board_columns WHERE id=?", id)
	s.TouchBoard(bid)
	return err
}

// ---------- 标签 ----------

func (s *Store) listLabels(boardID int64) ([]Label, error) {
	rows, err := s.db.Query(
		`SELECT id, board_id, name, color, position FROM labels WHERE board_id=? ORDER BY position, id`, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.BoardID, &l.Name, &l.Color, &l.Position); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

func (s *Store) labelsByCard(boardID int64) (map[int64][]Label, error) {
	rows, err := s.db.Query(
		`SELECT cl.card_id, l.id, l.board_id, l.name, l.color, l.position
		 FROM card_labels cl JOIN labels l ON l.id = cl.label_id
		 WHERE l.board_id=? ORDER BY l.position`, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]Label{}
	for rows.Next() {
		var cardID int64
		var l Label
		if err := rows.Scan(&cardID, &l.ID, &l.BoardID, &l.Name, &l.Color, &l.Position); err != nil {
			return nil, err
		}
		out[cardID] = append(out[cardID], l)
	}
	return out, nil
}

func (s *Store) CreateLabel(boardID int64, name, color string) (*Label, error) {
	if color == "" {
		color = "#7F77DD"
	}
	pos, err := s.nextPos("labels", "board_id", boardID, 0)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		`INSERT INTO labels(board_id, name, color, position) VALUES(?,?,?,?)`, boardID, name, color, pos)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	s.TouchBoard(boardID)
	return &Label{ID: id, BoardID: boardID, Name: name, Color: color, Position: pos}, nil
}

func (s *Store) UpdateLabel(id int64, name, color string) error {
	if name != "" {
		if _, err := s.db.Exec("UPDATE labels SET name=? WHERE id=?", name, id); err != nil {
			return err
		}
	}
	if color != "" {
		if _, err := s.db.Exec("UPDATE labels SET color=? WHERE id=?", color, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteLabel(id int64) error {
	_, err := s.db.Exec("DELETE FROM labels WHERE id=?", id)
	return err
}

func (s *Store) ToggleCardLabel(cardID, labelID int64, on bool) error {
	bid, err := s.boardIDByCard(cardID)
	var labelBoard int64
	if err != nil || s.db.QueryRow("SELECT board_id FROM labels WHERE id=?", labelID).Scan(&labelBoard) != nil || labelBoard != bid {
		return errScope
	}
	if on {
		_, err := s.db.Exec(
			`INSERT OR IGNORE INTO card_labels(card_id, label_id) VALUES(?,?)`, cardID, labelID)
		return err
	}
	_, err = s.db.Exec(`DELETE FROM card_labels WHERE card_id=? AND label_id=?`, cardID, labelID)
	return err
}

// ---------- 活动流 ----------

func (s *Store) ListActivities(cardID int64, limit int) ([]Activity, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.Query(
		`SELECT id, board_id, COALESCE(card_id,0), COALESCE(user_id,0), username, type, detail, created_at
		 FROM activities WHERE card_id=? ORDER BY id DESC LIMIT ?`, cardID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.BoardID, &a.CardID, &a.UserID, &a.Username,
			&a.Type, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}
