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
	filtered := []Board{}
	workspaceID := parseInt64(r.URL.Query().Get("workspace_id"))
	for _, b := range boards {
		if (workspaceID == 0 || b.WorkspaceID == workspaceID) && s.store.canWorkspace(currentUser(r), b.WorkspaceID) {
			filtered = append(filtered, b)
		}
	}
	if err := s.store.sortUserBoards(currentUser(r).ID, filtered); err != nil {
		writeErr(w, 500, "读取看板失败")
		return
	}
	writeJSON(w, http.StatusOK, filtered)
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		WorkspaceID int64  `json:"workspace_id"`
		Description string `json:"description"`
		Background  string `json:"background"`
	}
	if err := decode(r, &req); err != nil || !validBoardBackground(req.Background) {
		writeErr(w, 400, "看板设置格式不正确")
		return
	}
	if req.WorkspaceID == 0 {
		req.WorkspaceID = 1
	}
	if !s.store.canWorkspace(currentUser(r), req.WorkspaceID) {
		writeErr(w, 403, "没有这个工作空间的访问权限")
		return
	}
	cols := []string{"待办", "进行中", "已完成"}
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Accept-Language")), "en") {
		cols = []string{"To do", "In progress", "Done"}
	}
	b, err := s.store.createBoardWithColumns(strings.TrimSpace(req.Name), req.Description, req.Background, req.WorkspaceID, cols)
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
	previous, err := s.store.GetBoard(id)
	if err != nil {
		writeErr(w, 404, "看板不存在")
		return
	}
	if !validBoardBackground(req.Background) && req.Background != previous.Background {
		writeErr(w, 400, "背景格式不正确，请使用预设或上传图片")
		return
	}
	if err := s.store.UpdateBoard(id, strings.TrimSpace(req.Name), req.Description, req.Background, req.Archived); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	if req.Background != "" && req.Background != previous.Background {
		s.removeBoardBackground(previous.Background)
	}
	b, _ := s.store.GetBoard(id)
	s.publish(0, currentUser(r).Actor, "board.list", b)
	s.publish(id, currentUser(r).Actor, "board.updated", b)
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	b, err := s.store.GetBoard(id)
	if err != nil {
		writeErr(w, 404, "看板不存在")
		return
	}
	paths, err := s.store.attachmentPaths("board", id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取附件失败")
		return
	}
	if err := s.store.DeleteBoard(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.removeAttachmentFiles(paths)
	s.removeBoardBackground(b.Background)
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
		Name     string  `json:"name"`
		WipLimit *int    `json:"wip_limit"`
		Color    *string `json:"color"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if req.Color != nil {
		color := strings.ToUpper(strings.TrimSpace(*req.Color))
		if len(color) != 7 || color[0] != '#' || strings.Trim(color[1:], "0123456789ABCDEF") != "" {
			writeErr(w, http.StatusBadRequest, "颜色格式不正确，请使用六位十六进制颜色")
			return
		}
		req.Color = &color
	}
	if req.WipLimit != nil && *req.WipLimit < 0 {
		writeErr(w, http.StatusBadRequest, "列表上限不能小于 0")
		return
	}
	if _, err := s.store.GetColumn(id); err != nil {
		writeErr(w, http.StatusNotFound, "列表不存在")
		return
	}
	if err := s.store.UpdateColumn(id, strings.TrimSpace(req.Name), req.WipLimit, req.Color); err != nil {
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
	paths, err := s.store.attachmentPaths("column", id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取附件失败")
		return
	}
	if err := s.store.DeleteColumn(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.removeAttachmentFiles(paths)
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

// Archive an entire list in one transaction, instead of issuing one API call and
// full card query per card. History and undo through the archive box are retained.
func (s *Server) handleArchiveColumn(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	col, err := s.store.GetColumn(id)
	if err != nil {
		writeErr(w, 404, "列表不存在")
		return
	}
	tx, err := s.store.db.Begin()
	if err != nil {
		writeErr(w, 500, "归档失败")
		return
	}
	defer tx.Rollback()
	u := currentUser(r)
	timestamp := nowISO()
	_, err = tx.Exec(`INSERT INTO activities(board_id,card_id,user_id,username,type,detail,created_at)
 SELECT ?,id,?,?,'archived',title,? FROM cards WHERE column_id=? AND archived=0`, col.BoardID, u.ID, u.DisplayName, timestamp, id)
	if err == nil {
		_, err = tx.Exec(`UPDATE cards SET archived=1,updated_at=? WHERE column_id=? AND archived=0`, timestamp, id)
	}
	if err == nil {
		_, err = tx.Exec(`UPDATE boards SET updated_at=? WHERE id=?`, timestamp, col.BoardID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeErr(w, 500, "归档失败，请重试")
		return
	}
	s.publish(col.BoardID, u.Actor, "board.structure", nil)
	writeOK(w, nil)
}
