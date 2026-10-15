package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

// ---------- 卡片 ----------

func (s *Server) handleCreateCard(w http.ResponseWriter, r *http.Request) {
	columnID := pathID(r, "id")
	u := currentUser(r)
	var req struct {
		Title string `json:"title"`
	}
	if decode(r, &req) != nil {
		writeErr(w, 400, "请求格式不正确")
		return
	}
	if err := validateCardFields(&req.Title, nil, nil, nil); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c, err := s.store.CreateCard(columnID, strings.TrimSpace(req.Title), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建卡片失败")
		return
	}
	bid, _ := s.store.boardIDByColumn(columnID)
	s.store.logActivity(bid, c.ID, u.ID, u.DisplayName, "created", c.Title)
	s.publish(bid, u.Actor, "card.created", c)
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleGetCard(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetCard(pathID(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "卡片不存在")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleUpdateCard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	u := currentUser(r)
	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		DueDate     *string `json:"due_date"`
		Cover       *string `json:"cover"`
		Archived    *bool   `json:"archived"`
		Pinned      *bool   `json:"pinned"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if err := validateCardFields(req.Title, req.Description, req.DueDate, req.Cover); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	c, err := s.store.UpdateCard(id, CardPatch{
		Title: req.Title, Description: req.Description,
		DueDate: req.DueDate, Cover: req.Cover, Archived: req.Archived, Pinned: req.Pinned,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	bid, _ := s.store.boardIDByCard(id)
	if req.Archived != nil {
		if *req.Archived {
			s.store.logActivity(bid, id, u.ID, u.DisplayName, "archived", c.Title)
		} else {
			s.store.logActivity(bid, id, u.ID, u.DisplayName, "restored", c.Title)
		}
	}
	s.publish(bid, u.Actor, "card.updated", c)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleMoveCard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	u := currentUser(r)
	var req struct {
		ColumnID int64 `json:"column_id"`
		BeforeID int64 `json:"before_id"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if req.ColumnID == 0 {
		writeErr(w, http.StatusBadRequest, "缺少目标列表")
		return
	}
	c, err := s.store.MoveCard(id, req.ColumnID, req.BeforeID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "移动失败")
		return
	}
	bid, _ := s.store.boardIDByCard(id)
	s.publish(bid, u.Actor, "card.moved", c)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteCard(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	u := currentUser(r)
	bid, _ := s.store.boardIDByCard(id)
	paths, err := s.store.attachmentPaths("card", id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取附件失败")
		return
	}
	if err := s.store.DeleteCard(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.removeAttachmentFiles(paths)
	s.publish(bid, u.Actor, "card.deleted", map[string]int64{"id": id})
	writeOK(w, nil)
}

func (s *Server) handleToggleCardLabel(w http.ResponseWriter, r *http.Request) {
	cardID := pathID(r, "id")
	u := currentUser(r)
	var req struct {
		LabelID int64 `json:"label_id"`
		On      bool  `json:"on"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if err := s.store.ToggleCardLabel(cardID, req.LabelID, req.On); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新标签失败")
		return
	}
	c, _ := s.store.CardSummary(cardID)
	bid, _ := s.store.boardIDByCard(cardID)
	s.publish(bid, u.Actor, "card.updated", c)
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleCardActivities(w http.ResponseWriter, r *http.Request) {
	acts, err := s.store.ListActivities(pathID(r, "id"), 30)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取失败")
		return
	}
	writeJSON(w, http.StatusOK, acts)
}

// ---------- 清单 ----------

func (s *Server) boardAndCard(cardID int64) (int64, *Card) {
	bid, _ := s.store.boardIDByCard(cardID)
	c, _ := s.store.CardSummary(cardID)
	return bid, c
}

// 清单的增删改都会改变卡片上的进度条，因此统一广播 card.updated

func (s *Server) handleCreateChecklist(w http.ResponseWriter, r *http.Request) {
	cardID := pathID(r, "id")
	var req struct {
		Title string `json:"title"`
	}
	if err := decode(r, &req); err != nil || strings.TrimSpace(req.Title) == "" || len([]rune(req.Title)) > 120 {
		writeErr(w, 400, "清单名称不能为空，最多 120 字")
		return
	}
	cl, err := s.store.CreateChecklist(cardID, strings.TrimSpace(req.Title))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建清单失败")
		return
	}
	s.publishCard(cardID, currentUser(r).Actor)
	writeJSON(w, http.StatusCreated, cl)
}

func (s *Server) handleUpdateChecklist(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		Title string `json:"title"`
	}
	if err := decode(r, &req); err != nil || strings.TrimSpace(req.Title) == "" || len([]rune(req.Title)) > 120 {
		writeErr(w, 400, "清单名称不能为空，最多 120 字")
		return
	}
	cardID, err := s.store.checklistCard(id)
	if err != nil {
		writeErr(w, 404, "清单不存在")
		return
	}
	if err := s.store.UpdateChecklist(id, strings.TrimSpace(req.Title)); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	s.publishCard(cardID, currentUser(r).Actor)
	writeOK(w, nil)
}

func (s *Server) handleDeleteChecklist(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	cardID, _ := s.store.checklistCard(id)
	if err := s.store.DeleteChecklist(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.publishCard(cardID, currentUser(r).Actor)
	writeOK(w, nil)
}

func (s *Server) handleCreateChecklistItem(w http.ResponseWriter, r *http.Request) {
	listID := pathID(r, "id")
	var req struct {
		Text string `json:"text"`
	}
	_ = decode(r, &req)
	if strings.TrimSpace(req.Text) == "" {
		writeErr(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	it, err := s.store.CreateChecklistItem(listID, strings.TrimSpace(req.Text))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建失败")
		return
	}
	if cardID, err := s.store.checklistCard(listID); err == nil {
		s.publishCard(cardID, currentUser(r).Actor)
	}
	writeJSON(w, http.StatusCreated, it)
}

func (s *Server) handleUpdateChecklistItem(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	var req struct {
		Text *string `json:"text"`
		Done *bool   `json:"done"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	listID, _ := s.store.itemChecklist(id)
	if err := s.store.UpdateChecklistItem(id, derefStr(req.Text), req.Done); err != nil {
		writeErr(w, http.StatusInternalServerError, "更新失败")
		return
	}
	if cardID, err := s.store.checklistCard(listID); err == nil {
		s.publishCard(cardID, currentUser(r).Actor)
	}
	writeOK(w, nil)
}

func (s *Server) handleDeleteChecklistItem(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	listID, _ := s.store.itemChecklist(id)
	cardID, _ := s.store.checklistCard(listID)
	if err := s.store.DeleteChecklistItem(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.publishCard(cardID, currentUser(r).Actor)
	writeOK(w, nil)
}

func (s *Server) publishCard(cardID int64, actor string) {
	bid, c := s.boardAndCard(cardID)
	if c != nil {
		s.publish(bid, actor, "card.updated", c)
	}
}

// ---------- 附件 ----------

const maxUpload = 32 << 20

func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	cardID := pathID(r, "id")
	u := currentUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeErr(w, http.StatusBadRequest, "上传内容过大或格式错误")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少文件")
		return
	}
	defer file.Close()
	if header.Size > maxUpload {
		writeErr(w, http.StatusRequestEntityTooLarge, "附件不能超过 32 MB")
		return
	}

	name := sanitizeFilename(header.Filename)
	stored, err := randomToken(12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成文件名失败")
		return
	}
	ext := strings.ToLower(filepath.Ext(name))
	rel := "files/" + stored + ext
	dest := filepath.Join(s.dataDir, filepath.FromSlash(rel))
	if err := ensureDir(filepath.Dir(dest)); err != nil {
		writeErr(w, http.StatusInternalServerError, "写入失败")
		return
	}
	if err := copyFile(dest, file); err != nil {
		writeErr(w, http.StatusInternalServerError, "写入失败")
		return
	}
	att, err := s.store.CreateAttachment(cardID, name, "/files/"+stored+ext, header.Size)
	if err != nil {
		removeFile(dest)
		writeErr(w, http.StatusInternalServerError, "保存记录失败")
		return
	}
	s.publishCard(cardID, u.Actor)
	writeJSON(w, http.StatusCreated, att)
}

func (s *Server) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	u := currentUser(r)
	a, err := s.store.GetAttachment(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "附件不存在")
		return
	}
	if err := s.store.DeleteAttachment(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.removeAttachmentFiles([]string{a.Path})
	s.publishCard(a.CardID, u.Actor)
	writeOK(w, nil)
}
