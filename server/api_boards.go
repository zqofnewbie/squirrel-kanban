package main

import (
	"net/http"
	"strings"
)

// ---------- 看板 ----------

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	boards, err := s.store.ListBoards()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取看板失败")
		return
	}
	writeJSON(w, http.StatusOK, boards)
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Background  string `json:"background"`
	}
	_ = decode(r, &req)
	b, err := s.store.CreateBoard(strings.TrimSpace(req.Name), req.Description, req.Background)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建看板失败")
		return
	}
	s.publish(0, currentUser(r).Actor, "board.list", b)
	writeJSON(w, http.StatusCreated, b)
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	d, err := s.store.GetBoardDetail(pathID(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "看板不存在")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleUpdateBoard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Background  string `json:"background"`
		Archived    *bool  `json:"archived"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if err := s.store.UpdateBoard(id, strings.TrimSpace(req.Name), req.Description, req.Background, req.Archived); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	b, _ := s.store.GetBoard(id)
	s.publish(0, currentUser(r).Actor, "board.list", b)
	s.publish(id, currentUser(r).Actor, "board.updated", b)
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	if err := s.store.DeleteBoard(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.publish(0, currentUser(r).Actor, "board.list.deleted", map[string]int64{"id": id})
	writeOK(w, nil)
}

func (s *Server) handleArchivedCards(w http.ResponseWriter, r *http.Request) {
	cards, err := s.store.ListArchivedCards(pathID(r, "id"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取失败")
		return
	}
	writeJSON(w, http.StatusOK, cards)
}

func (s *Server) handleNormalizeBoard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	cols, err := s.store.db.Query(
		"SELECT id FROM board_columns WHERE board_id=? ORDER BY position, id", id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "整理失败")
		return
	}
	ids := []int64{}
	for cols.Next() {
		var cid int64
		if err := cols.Scan(&cid); err == nil {
			ids = append(ids, cid)
		}
	}
	cols.Close() // 先释放连接，再做后续查询
	for _, cid := range ids {
		_ = s.store.normalize("cards", "column_id", cid)
	}
	_ = s.store.normalize("board_columns", "board_id", id)
	s.publish(id, currentUser(r).Actor, "board.structure", nil)
	writeOK(w, nil)
}

// ---------- 列 ----------

func (s *Server) handleCreateColumn(w http.ResponseWriter, r *http.Request) {
	boardID := pathID(r, "id")
	var req struct {
		Name string `json:"name"`
	}
	_ = decode(r, &req)
	c, err := s.store.CreateColumn(boardID, strings.TrimSpace(req.Name))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建列表失败")
		return
	}
	s.publish(boardID, currentUser(r).Actor, "board.structure", nil)
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleUpdateColumn(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		Name     string `json:"name"`
		WipLimit *int   `json:"wip_limit"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if err := s.store.UpdateColumn(id, strings.TrimSpace(req.Name), req.WipLimit); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	c, _ := s.store.GetColumn(id)
	s.publish(c.BoardID, currentUser(r).Actor, "board.structure", nil)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleMoveColumn(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		BeforeID int64 `json:"before_id"`
	}
	_ = decode(r, &req)
	if err := s.store.MoveColumn(id, req.BeforeID); err != nil {
		writeErr(w, http.StatusBadRequest, "移动失败")
		return
	}
	c, _ := s.store.GetColumn(id)
	s.publish(c.BoardID, currentUser(r).Actor, "board.structure", nil)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteColumn(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	c, err := s.store.GetColumn(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "列表不存在")
		return
	}
	if err := s.store.DeleteColumn(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.publish(c.BoardID, currentUser(r).Actor, "board.structure", nil)
	writeOK(w, nil)
}

// ---------- 标签 ----------

func (s *Server) handleCreateLabel(w http.ResponseWriter, r *http.Request) {
	boardID := pathID(r, "id")
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	_ = decode(r, &req)
	l, err := s.store.CreateLabel(boardID, strings.TrimSpace(req.Name), req.Color)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建标签失败")
		return
	}
	s.publish(boardID, currentUser(r).Actor, "board.structure", nil)
	writeJSON(w, http.StatusCreated, l)
}

func (s *Server) handleUpdateLabel(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	_ = decode(r, &req)
	if err := s.store.UpdateLabel(id, strings.TrimSpace(req.Name), req.Color); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	var boardID int64
	_ = s.store.db.QueryRow("SELECT board_id FROM labels WHERE id=?", id).Scan(&boardID)
	s.publish(boardID, currentUser(r).Actor, "board.structure", nil)
	writeOK(w, nil)
}

func (s *Server) handleDeleteLabel(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var boardID int64
	_ = s.store.db.QueryRow("SELECT board_id FROM labels WHERE id=?", id).Scan(&boardID)
	if err := s.store.DeleteLabel(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.publish(boardID, currentUser(r).Actor, "board.structure", nil)
	writeOK(w, nil)
}
