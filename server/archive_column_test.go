package main

import (
	"fmt"
	"net/http"
	"testing"
)

func TestArchiveColumnIsAtomicScopedAndKeepsHistory(t *testing.T) {
	s := testStore(t)
	s.CreateUser("admin", "管理员", "test-pass", "admin", false)
	session, _ := s.CreateSession(1, "test")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	board, _ := s.CreateBoard("归档", "", "")
	detail, _ := s.GetBoardDetail(board.ID)
	col := detail.Columns[0].ID
	timestamp := nowISO()
	tx, _ := s.db.Begin()
	for i := 0; i < 1000; i++ {
		if _, err := tx.Exec(`INSERT INTO cards(column_id,title,position,created_at,updated_at) VALUES(?,?,?,?,?)`, col, fmt.Sprintf("任务 %d", i), i*1024, timestamp, timestamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	other, _ := s.CreateCard(detail.Columns[1].ID, "保留", 1)
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	path := fmt.Sprintf("/api/columns/%d/archive", col)
	mustStatus(t, apiCall(t, h, "POST", path, "", nil), 401)
	mustStatus(t, apiCall(t, h, "POST", path, "", cookie), 200)
	count, _ := s.queryInt(`SELECT COUNT(*) FROM cards WHERE column_id=? AND archived=1`, col)
	history, _ := s.queryInt(`SELECT COUNT(*) FROM activities WHERE type='archived'`)
	kept, _ := s.GetCard(other.ID)
	if count != 1000 || history != 1000 || kept.Archived {
		t.Fatal("批量归档遗漏卡片、历史或越过列表范围")
	}
	mustStatus(t, apiCall(t, h, "POST", path, "", cookie), 200)
	history, _ = s.queryInt(`SELECT COUNT(*) FROM activities WHERE type='archived'`)
	if history != 1000 {
		t.Fatal("重复归档不应重复写历史")
	}
	var first int64
	s.db.QueryRow(`SELECT id FROM cards WHERE column_id=? LIMIT 1`, col).Scan(&first)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/cards/%d", first), `{"archived":false}`, cookie), 200)
	restored, _ := s.GetCard(first)
	if restored.Archived {
		t.Fatal("批量归档后的卡片应能单独恢复")
	}
	mustStatus(t, apiCall(t, h, "POST", "/api/columns/999999/archive", "", cookie), 404)
}
