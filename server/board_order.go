package main

import (
	"net/http"
	"sort"
)

func (s *Server) handleBoardOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkspaceID int64   `json:"workspace_id"`
		IDs         []int64 `json:"ids"`
	}
	if decode(r, &req) != nil || len(req.IDs) == 0 {
		writeErr(w, 400, "请求格式不正确")
		return
	}
	u := currentUser(r)
	if !s.store.canWorkspace(u, req.WorkspaceID) {
		writeErr(w, 403, "没有这个工作空间的访问权限")
		return
	}
	tx, err := s.store.db.Begin()
	if err != nil {
		writeErr(w, 500, "更新失败")
		return
	}
	defer tx.Rollback()
	seen := map[int64]bool{}
	for i, id := range req.IDs {
		var workspace int64
		if seen[id] || tx.QueryRow("SELECT workspace_id FROM boards WHERE id=? AND archived=0", id).Scan(&workspace) != nil || workspace != req.WorkspaceID {
			writeErr(w, 400, "请求格式不正确")
			return
		}
		seen[id] = true
		if _, err = tx.Exec("INSERT INTO user_board_order(user_id, board_id, position) VALUES(?,?,?) ON CONFLICT(user_id,board_id) DO UPDATE SET position=excluded.position", u.ID, id, i); err != nil {
			writeErr(w, 500, "更新失败")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, 500, "更新失败")
		return
	}
	writeOK(w, nil)
}

func (s *Store) sortUserBoards(userID int64, boards []Board) error {
	rows, err := s.db.Query("SELECT board_id, position FROM user_board_order WHERE user_id=?", userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	order := map[int64]int{}
	for rows.Next() {
		var id int64
		var position int
		if err := rows.Scan(&id, &position); err != nil {
			return err
		}
		order[id] = position
	}
	if err := rows.Err(); err != nil {
		return err
	}
	sort.SliceStable(boards, func(i, j int) bool {
		a, hasA := order[boards[i].ID]
		b, hasB := order[boards[j].ID]
		if hasA != hasB {
			return hasA
		}
		return hasA && a < b
	})
	return nil
}
