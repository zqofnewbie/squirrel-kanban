package main

import "strings"

// ---------- 卡片 ----------

func (s *Store) CreateCard(columnID int64, title string, createdBy int64) (*Card, error) {
	if strings.TrimSpace(title) == "" {
		title = "新卡片"
	}
	pos, err := s.firstPos("cards", "column_id", columnID)
	if err != nil {
		return nil, err
	}
	now := nowISO()
	res, err := s.db.Exec(
		`INSERT INTO cards(column_id, title, position, created_by, created_at, updated_at)
		 VALUES(?,?,?,?,?,?)`, columnID, title, pos, nullInt(createdBy), now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	bid, _ := s.boardIDByColumn(columnID)
	s.TouchBoard(bid)
	return s.GetCard(id)
}

func (s *Store) GetCard(id int64) (*Card, error) {
	var c Card
	var arch int
	var due, cover string
	err := s.db.QueryRow(
		`SELECT id, column_id, title, description, position, COALESCE(due_date,''), cover, pinned,
		        archived, COALESCE(created_by,0), created_at, updated_at
		 FROM cards WHERE id=?`, id).
		Scan(&c.ID, &c.ColumnID, &c.Title, &c.Description, &c.Position, &due, &cover, &c.Pinned,
			&arch, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, ErrNotFound
	}
	c.Archived = arch == 1
	c.DueDate = due
	c.Cover = cover
	c.Labels = s.cardLabels(id)
	c.Checklists = s.cardChecklists(id)
	c.Attachments = s.cardAttachments(id)
	c.AttachmentCount = len(c.Attachments)
	c.CommentCount, _ = s.queryInt("SELECT COUNT(*) FROM card_comments WHERE card_id=?", id)
	for _, cl := range c.Checklists {
		c.ChecklistTotal += len(cl.Items)
		for _, it := range cl.Items {
			if it.Done {
				c.ChecklistDone++
			}
		}
	}
	return &c, nil
}

func (s *Store) cardLabels(cardID int64) []Label {
	rows, err := s.db.Query(
		`SELECT l.id, l.board_id, l.name, l.color, l.position
		 FROM card_labels cl JOIN labels l ON l.id=cl.label_id
		 WHERE cl.card_id=? ORDER BY l.position`, cardID)
	if err != nil {
		return []Label{}
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.BoardID, &l.Name, &l.Color, &l.Position); err == nil {
			out = append(out, l)
		}
	}
	return out
}

// CardSummary 用于事件广播：只带看板视图需要的字段。
func (s *Store) CardSummary(id int64) (*Card, error) {
	var c Card
	var arch int
	err := s.db.QueryRow(
		`SELECT c.id, c.column_id, c.title, c.description, c.position,
		        COALESCE(c.due_date,''), c.cover, c.pinned, c.archived, c.created_at, c.updated_at,
		        (SELECT COUNT(*) FROM checklist_items i JOIN checklists k ON k.id=i.checklist_id
		          WHERE k.card_id=c.id) AS total,
		        (SELECT COUNT(*) FROM checklist_items i JOIN checklists k ON k.id=i.checklist_id
		          WHERE k.card_id=c.id AND i.done=1) AS done,
		        (SELECT COUNT(*) FROM attachments a WHERE a.card_id=c.id),
 (SELECT COUNT(*) FROM card_comments m WHERE m.card_id=c.id) AS files
		 FROM cards c WHERE c.id=?`, id).
		Scan(&c.ID, &c.ColumnID, &c.Title, &c.Description, &c.Position, &c.DueDate, &c.Cover, &c.Pinned,
			&arch, &c.CreatedAt, &c.UpdatedAt, &c.ChecklistTotal, &c.ChecklistDone, &c.AttachmentCount, &c.CommentCount)
	if err != nil {
		return nil, ErrNotFound
	}
	c.Archived = arch == 1
	c.Labels = s.cardLabels(id)
	return &c, nil
}

type CardPatch struct {
	Pinned      *bool
	Title       *string
	Description *string
	DueDate     *string
	Cover       *string
	Archived    *bool
}

func (s *Store) UpdateCard(id int64, p CardPatch) (*Card, error) {
	if p.Pinned != nil {
		if _, err := s.db.Exec("UPDATE cards SET pinned=? WHERE id=?", boolInt(*p.Pinned), id); err != nil {
			return nil, err
		}
	}
	if p.Title != nil {
		if _, err := s.db.Exec("UPDATE cards SET title=? WHERE id=?", *p.Title, id); err != nil {
			return nil, err
		}
	}
	if p.Description != nil {
		if _, err := s.db.Exec("UPDATE cards SET description=? WHERE id=?", *p.Description, id); err != nil {
			return nil, err
		}
	}
	if p.DueDate != nil {
		v := any(nil)
		if *p.DueDate != "" {
			v = *p.DueDate
		}
		if _, err := s.db.Exec("UPDATE cards SET due_date=? WHERE id=?", v, id); err != nil {
			return nil, err
		}
	}
	if p.Cover != nil {
		if _, err := s.db.Exec("UPDATE cards SET cover=? WHERE id=?", *p.Cover, id); err != nil {
			return nil, err
		}
	}
	if p.Archived != nil {
		if _, err := s.db.Exec("UPDATE cards SET archived=? WHERE id=?", boolInt(*p.Archived), id); err != nil {
			return nil, err
		}
	}
	if _, err := s.db.Exec("UPDATE cards SET updated_at=? WHERE id=?", nowISO(), id); err != nil {
		return nil, err
	}
	bid, _ := s.boardIDByCard(id)
	s.TouchBoard(bid)
	return s.CardSummary(id)
}

// MoveCard 支持同列排序与跨列拖拽，beforeID=0 表示放到末尾。
func (s *Store) MoveCard(id, columnID, beforeID int64) (*Card, error) {
	source, e1 := s.boardIDByCard(id)
	target, e2 := s.boardIDByColumn(columnID)
	if e1 != nil || e2 != nil || source != target {
		return nil, errScope
	}
	if beforeID != 0 {
		var targetCol int64
		if s.db.QueryRow("SELECT column_id FROM cards WHERE id=?", beforeID).Scan(&targetCol) != nil || targetCol != columnID {
			return nil, errScope
		}
	}
	var oldCol int64
	if err := s.db.QueryRow("SELECT column_id FROM cards WHERE id=?", id).Scan(&oldCol); err != nil {
		return nil, ErrNotFound
	}
	pos, err := s.nextPos("cards", "column_id", columnID, beforeID)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(
		"UPDATE cards SET column_id=?, position=?, updated_at=? WHERE id=?",
		columnID, pos, nowISO(), id); err != nil {
		return nil, err
	}
	if oldCol != columnID {
		bid, _ := s.boardIDByColumn(columnID)
		s.TouchBoard(bid)
	}
	return s.CardSummary(id)
}

func (s *Store) DeleteCard(id int64) error {
	bid, _ := s.boardIDByCard(id)
	_, err := s.db.Exec("DELETE FROM cards WHERE id=?", id)
	s.TouchBoard(bid)
	return err
}

// ---------- 清单 ----------

func (s *Store) cardChecklists(cardID int64) []Checklist {
	rows, err := s.db.Query(
		"SELECT id, card_id, title, position FROM checklists WHERE card_id=? ORDER BY position, id", cardID)
	if err != nil {
		return []Checklist{}
	}
	defer rows.Close()
	ids := []int64{}
	out := []Checklist{}
	for rows.Next() {
		var c Checklist
		if err := rows.Scan(&c.ID, &c.CardID, &c.Title, &c.Position); err == nil {
			ids = append(ids, c.ID)
			out = append(out, c)
		}
	}
	rows.Close()

	items, err := s.db.Query(
		`SELECT i.id, i.checklist_id, i.text, i.done, i.position
         FROM checklist_items i JOIN checklists k ON k.id=i.checklist_id
         WHERE k.card_id=? ORDER BY i.position, i.id`, cardID)
	if err != nil {
		return out
	}
	defer items.Close()
	byList := map[int64][]ChecklistItem{}
	for items.Next() {
		var it ChecklistItem
		var done int
		if err := items.Scan(&it.ID, &it.ChecklistID, &it.Text, &done, &it.Position); err == nil {
			it.Done = done == 1
			byList[it.ChecklistID] = append(byList[it.ChecklistID], it)
		}
	}
	for i := range out {
		if v, ok := byList[out[i].ID]; ok {
			out[i].Items = v
		} else {
			out[i].Items = []ChecklistItem{}
		}
	}
	return out
}

func (s *Store) CreateChecklist(cardID int64, title string) (*Checklist, error) {
	pos, err := s.nextPos("checklists", "card_id", cardID, 0)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		"INSERT INTO checklists(card_id, title, position) VALUES(?,?,?)", cardID, title, pos)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Checklist{ID: id, CardID: cardID, Title: title, Position: pos, Items: []ChecklistItem{}}, nil
}

func (s *Store) UpdateChecklist(id int64, title string) error {
	_, err := s.db.Exec("UPDATE checklists SET title=? WHERE id=?", title, id)
	return err
}

func (s *Store) DeleteChecklist(id int64) error {
	_, err := s.db.Exec("DELETE FROM checklists WHERE id=?", id)
	return err
}

func (s *Store) checklistCard(id int64) (int64, error) {
	var cardID int64
	err := s.db.QueryRow("SELECT card_id FROM checklists WHERE id=?", id).Scan(&cardID)
	return cardID, err
}

func (s *Store) CreateChecklistItem(listID int64, text string) (*ChecklistItem, error) {
	pos, err := s.nextPos("checklist_items", "checklist_id", listID, 0)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		"INSERT INTO checklist_items(checklist_id, text, done, position) VALUES(?,?,0,?)", listID, text, pos)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &ChecklistItem{ID: id, ChecklistID: listID, Text: text, Position: pos}, nil
}

func (s *Store) UpdateChecklistItem(id int64, text string, done *bool) error {
	if text != "" {
		if _, err := s.db.Exec("UPDATE checklist_items SET text=? WHERE id=?", text, id); err != nil {
			return err
		}
	}
	if done != nil {
		if _, err := s.db.Exec("UPDATE checklist_items SET done=? WHERE id=?", boolInt(*done), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteChecklistItem(id int64) error {
	_, err := s.db.Exec("DELETE FROM checklist_items WHERE id=?", id)
	return err
}

func (s *Store) itemChecklist(id int64) (int64, error) {
	var listID int64
	err := s.db.QueryRow("SELECT checklist_id FROM checklist_items WHERE id=?", id).Scan(&listID)
	return listID, err
}

// ---------- 附件 ----------

func (s *Store) cardAttachments(cardID int64) []Attachment {
	rows, err := s.db.Query(
		"SELECT id, card_id, name, path, size, created_at FROM attachments WHERE card_id=? ORDER BY id", cardID)
	if err != nil {
		return []Attachment{}
	}
	defer rows.Close()
	out := []Attachment{}
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.CardID, &a.Name, &a.Path, &a.Size, &a.CreatedAt); err == nil {
			out = append(out, a)
		}
	}
	return out
}

func (s *Store) CreateAttachment(cardID int64, name, path string, size int64) (*Attachment, error) {
	now := nowISO()
	res, err := s.db.Exec(
		"INSERT INTO attachments(card_id, name, path, size, created_at) VALUES(?,?,?,?,?)",
		cardID, name, path, size, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Attachment{ID: id, CardID: cardID, Name: name, Path: path, Size: size, CreatedAt: now}, nil
}

func (s *Store) GetAttachment(id int64) (*Attachment, error) {
	var a Attachment
	err := s.db.QueryRow(
		"SELECT id, card_id, name, path, size, created_at FROM attachments WHERE id=?", id).
		Scan(&a.ID, &a.CardID, &a.Name, &a.Path, &a.Size, &a.CreatedAt)
	if err != nil {
		return nil, ErrNotFound
	}
	return &a, nil
}

func (s *Store) DeleteAttachment(id int64) error {
	_, err := s.db.Exec("DELETE FROM attachments WHERE id=?", id)
	return err
}
