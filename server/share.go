package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type SharePermissions struct {
	Pin       bool `json:"pin"`
	Cover     bool `json:"cover"`
	Download  bool `json:"download"`
	Comment   bool `json:"comment"`
	Checklist bool `json:"checklist"`
	Move      bool `json:"move"`
	Edit      bool `json:"edit"`
	Create    bool `json:"create"`
}
type BoardShare struct {
	ID            string `json:"id"`
	BoardID       int64  `json:"board_id"`
	ShortKey      string `json:"short_key,omitempty"`
	Name          string `json:"name"`
	CreatedAt     string `json:"created_at"`
	BoardArchived bool   `json:"board_archived"`
	guestPath     string
	Key           string           `json:"key,omitempty"` // 仅管理员设置接口返回，访客从不收到此字段。
	Enabled       bool             `json:"enabled"`
	ExpiresAt     string           `json:"expires_at"`
	Permissions   SharePermissions `json:"permissions"`
}
type Comment struct {
	ID        int64  `json:"id"`
	CardID    int64  `json:"card_id"`
	Author    string `json:"author"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func (s *Store) shareBy(field string, value any) (*BoardShare, error) {
	sh := &BoardShare{}
	var enabled, archived int
	var permissions string
	err := s.db.QueryRow("SELECT id,board_id,access_key,enabled,expires_at,permissions,short_key,name,created_at,(SELECT archived FROM boards WHERE id=board_shares.board_id) FROM board_shares WHERE "+field+"=?", value).Scan(&sh.ID, &sh.BoardID, &sh.Key, &enabled, &sh.ExpiresAt, &permissions, &sh.ShortKey, &sh.Name, &sh.CreatedAt, &archived)
	if err != nil {
		return nil, err
	}
	sh.Enabled = enabled == 1
	sh.BoardArchived = archived == 1
	if err = json.Unmarshal([]byte(permissions), &sh.Permissions); err != nil {
		return nil, err
	}
	return sh, nil
}
func (sh *BoardShare) active() bool {
	if !sh.Enabled || sh.BoardArchived {
		return false
	}
	if sh.ExpiresAt == "" {
		return true
	}
	exp, err := time.Parse(time.RFC3339, sh.ExpiresAt)
	return err == nil && time.Now().Before(exp)
}
func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func validOrigin(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == "GET" || r.Method == "HEAD" {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host {
			writeErr(w, 403, "不允许跨站操作")
			return false
		}
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		writeErr(w, 403, "不允许跨站操作")
		return false
	}
	return true
}
func shareDecode(r *http.Request, v any) error {
	defer r.Body.Close()
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return errors.New("需要 JSON 请求")
	}
	d := json.NewDecoder(io.LimitReader(r.Body, 128<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("多余的请求内容")
	}
	return nil
}
func (s *Server) shareRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/shares", s.withAuth(s.handleListShares))
	mux.HandleFunc("POST /api/shares", s.withAuth(s.handleShareRecord))
	mux.HandleFunc("GET /api/shares/{sid}", s.withAuth(s.handleShareRecord))
	mux.HandleFunc("PATCH /api/shares/{sid}", s.withAuth(s.handleShareRecord))
	mux.HandleFunc("DELETE /api/shares/{sid}", s.withAuth(s.handleShareRecord))
	mux.HandleFunc("POST /api/shared/{sid}/session", s.handleShareSession)
	mux.HandleFunc("GET /api/shared/{sid}/background", s.shared(s.handleSharedBackground))
	mux.HandleFunc("GET /api/shared/{sid}/board", s.shared(s.handleSharedBoard))
	mux.HandleFunc("GET /api/shared/{sid}/cards/{id}", s.shared(s.handleSharedCard))
	mux.HandleFunc("PATCH /api/shared/{sid}/cards/{id}", s.shared(s.handleSharedEdit))
	mux.HandleFunc("POST /api/shared/{sid}/cards/{id}/move", s.shared(s.handleSharedMove))
	mux.HandleFunc("POST /api/shared/{sid}/columns/{id}/cards", s.shared(s.handleSharedCreate))
	mux.HandleFunc("PATCH /api/shared/{sid}/items/{id}", s.shared(s.handleSharedItem))
	mux.HandleFunc("GET /api/shared/{sid}/attachments/{id}", s.shared(s.handleSharedDownload))
	mux.HandleFunc("GET /api/shared/{sid}/cards/{id}/comments", s.shared(s.handleSharedComments))
	mux.HandleFunc("POST /api/shared/{sid}/cards/{id}/comments", s.shared(s.handleSharedComments))
	mux.HandleFunc("GET /api/cards/{id}/comments", s.withAuth(s.handleAdminComments))
	mux.HandleFunc("POST /api/cards/{id}/comments", s.withAuth(s.handleAdminComments))
	mux.HandleFunc("DELETE /api/comments/{id}", s.withAuth(s.handleDeleteComment))
}
func (s *Server) handleShareRecord(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	var sh *BoardShare
	if r.Method != "POST" {
		var err error
		sh, err = s.store.shareBy("id", r.PathValue("sid"))
		if err != nil {
			writeErr(w, 404, "分享记录不存在")
			return
		}
		if r.Method == "GET" {
			writeOK(w, sh)
			return
		}
		if r.Method == "DELETE" {
			if _, err = s.store.db.Exec("DELETE FROM board_shares WHERE id=?", sh.ID); err != nil {
				writeErr(w, 500, "删除分享失败，请重试")
				return
			}
			writeOK(w, nil)
			return
		}
	}
	var req struct {
		BoardID     int64            `json:"board_id"`
		Name        string           `json:"name"`
		Enabled     bool             `json:"enabled"`
		ExpiresAt   string           `json:"expires_at"`
		Permissions SharePermissions `json:"permissions"`
	}
	if shareDecode(r, &req) != nil {
		writeErr(w, 400, "分享设置格式不正确")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 80 {
		writeErr(w, 400, "分享名称需要 1–80 个字")
		return
	}
	if sh != nil && req.BoardID != 0 && req.BoardID != sh.BoardID {
		writeErr(w, 400, "已创建的分享不能更换看板，请新建一条分享")
		return
	}
	bid := req.BoardID
	if sh != nil {
		bid = sh.BoardID
	}
	if !s.store.canBoard(currentUser(r), bid) {
		writeErr(w, 403, "没有这个看板的访问权限")
		return
	}
	board, err := s.store.GetBoard(bid)
	if err != nil || (board.Archived && req.Enabled && sh == nil) {
		writeErr(w, 404, "看板不存在或已归档")
		return
	}
	if req.ExpiresAt != "" {
		exp, e := time.Parse(time.RFC3339, req.ExpiresAt)
		if e != nil {
			writeErr(w, 400, "有效期格式不正确")
			return
		}
		req.ExpiresAt = exp.UTC().Format(time.RFC3339)
	}
	if sh == nil {
		id, e := randomToken(16)
		if e != nil {
			writeErr(w, 500, "创建分享失败")
			return
		}
		key, e := randomToken(32)
		if e != nil {
			writeErr(w, 500, "创建分享失败")
			return
		}
		short, e := shortShareKey()
		if e != nil {
			writeErr(w, 500, "创建分享失败")
			return
		}
		sh = &BoardShare{ID: id, Key: key, ShortKey: short, BoardID: bid, CreatedAt: nowISO()}
	}
	perms, _ := json.Marshal(req.Permissions)
	tx, err := s.store.db.Begin()
	if err != nil {
		writeErr(w, 500, "保存失败")
		return
	}
	defer tx.Rollback()
	if r.Method == "POST" {
		_, err = tx.Exec(`INSERT INTO board_shares(id,board_id,access_key,short_key,name,created_at,enabled,expires_at,permissions) VALUES(?,?,?,?,?,?,?,?,?)`, sh.ID, sh.BoardID, sh.Key, sh.ShortKey, req.Name, sh.CreatedAt, boolInt(req.Enabled), req.ExpiresAt, string(perms))
	} else {
		var result sql.Result
		result, err = tx.Exec(`UPDATE board_shares SET name=?,enabled=?,expires_at=?,permissions=? WHERE id=?`, req.Name, boolInt(req.Enabled), req.ExpiresAt, string(perms), sh.ID)
		if err == nil {
			n, _ := result.RowsAffected()
			if n != 1 {
				writeErr(w, 404, "分享记录已删除，请刷新")
				return
			}
		}
	}
	if err == nil && !req.Enabled {
		_, err = tx.Exec("DELETE FROM share_sessions WHERE share_id=?", sh.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeErr(w, 500, "保存失败")
		return
	}
	sh.BoardArchived = board.Archived
	sh.Name = req.Name
	sh.Enabled = req.Enabled
	sh.ExpiresAt = req.ExpiresAt
	sh.Permissions = req.Permissions
	if r.Method == "POST" {
		writeJSON(w, 201, sh)
	} else {
		writeOK(w, sh)
	}
}
func (s *Store) shareForGuest(sid string) (*BoardShare, error) {
	field := "id"
	if len(sid) == 22 {
		field = "short_key"
	}
	sh, err := s.shareBy(field, sid)
	if err == nil {
		sh.guestPath = sid
	}
	return sh, err
}
func (s *Server) handleShareSession(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	var req struct {
		Key string `json:"key"`
	}
	if shareDecode(r, &req) != nil {
		writeErr(w, 400, "分享链接不完整")
		return
	}
	sh, err := s.store.shareForGuest(r.PathValue("sid"))
	if err == nil && len(r.PathValue("sid")) == 22 {
		req.Key = sh.Key
	}
	if err != nil || !sh.active() || subtle.ConstantTimeCompare([]byte(req.Key), []byte(sh.Key)) != 1 {
		writeErr(w, 403, "分享链接无效、已关闭或已过期")
		return
	}
	token, err := randomToken(32)
	if err != nil {
		writeErr(w, 500, "创建访问会话失败")
		return
	}
	result, err := s.store.db.Exec(`INSERT INTO share_sessions(token_hash,share_id,expires_at)
 SELECT ?,id,? FROM board_shares WHERE id=? AND access_key=? AND enabled=1 AND (expires_at='' OR expires_at>?)`, tokenHash(token), time.Now().UTC().Add(24*time.Hour).Format(time.RFC3339), sh.ID, req.Key, nowISO())
	if err != nil {
		writeErr(w, 500, "创建访问会话失败")
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		writeErr(w, 403, "分享链接已失效")
		return
	}
	// 同一分享浏览器只保留一个会话，并清理过期记录。
	if old, e := r.Cookie("squirrel_share"); e == nil {
		s.store.db.Exec("DELETE FROM share_sessions WHERE token_hash=? AND share_id=?", tokenHash(old.Value), sh.ID)
	}
	s.store.db.Exec("DELETE FROM share_sessions WHERE expires_at<=?", nowISO())
	secure := envBool("KANBAN_COOKIE_SECURE") || r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{Name: "squirrel_share", Value: token, Path: "/api/shared/" + r.PathValue("sid") + "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: 86400})
	writeOK(w, nil)
}
func (s *Server) guestShare(r *http.Request) (*BoardShare, error) {
	c, err := r.Cookie("squirrel_share")
	if err != nil {
		return nil, err
	}
	sh, err := s.store.shareForGuest(r.PathValue("sid"))
	if err != nil || !sh.active() {
		return nil, errors.New("分享已失效")
	}
	n, err := s.store.queryInt("SELECT COUNT(*) FROM share_sessions WHERE token_hash=? AND share_id=? AND expires_at>?", tokenHash(c.Value), sh.ID, nowISO())
	if err != nil || n != 1 {
		return nil, errors.New("分享会话已失效")
	}
	n, err = s.store.queryInt("SELECT COUNT(*) FROM boards WHERE id=? AND archived=0", sh.BoardID)
	if err != nil || n != 1 {
		return nil, errors.New("分享看板不可用")
	}
	return sh, nil
}
func (s *Server) shared(next func(http.ResponseWriter, *http.Request, *BoardShare)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !validOrigin(w, r) {
			return
		}
		sh, err := s.guestShare(r)
		if err != nil {
			writeErr(w, 403, "分享链接无效、已关闭或已过期，请重新打开分享链接")
			return
		}
		next(w, r, sh)
	}
}
func requireShare(w http.ResponseWriter, allowed bool) bool {
	if !allowed {
		writeErr(w, 403, "管理员未开启此协作权限")
	}
	return allowed
}
func (s *Server) sharedCard(sh *BoardShare, id int64) (*Card, error) {
	bid, err := s.store.boardIDByCard(id)
	if err != nil || bid != sh.BoardID {
		return nil, ErrNotFound
	}
	c, err := s.store.GetCard(id)
	if err != nil || c.Archived {
		return nil, ErrNotFound
	}
	return c, nil
}
func sanitizeSharedCard(c *Card, sh *BoardShare) {
	c.CreatedBy = 0
	if !sh.Permissions.Download {
		c.Attachments = nil
		c.AttachmentCount = 0
	} else {
		for i := range c.Attachments {
			c.Attachments[i].Path = "/api/shared/" + sh.guestPath + "/attachments/" + strconv.FormatInt(c.Attachments[i].ID, 10)
		}
	}
}
func (s *Server) handleSharedBoard(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	b, err := s.store.GetBoardDetail(sh.BoardID)
	if err != nil || b.Archived {
		writeErr(w, 404, "看板不存在")
		return
	}
	for i := range b.Columns {
		for j := range b.Columns[i].Cards {
			sanitizeSharedCard(&b.Columns[i].Cards[j], sh)
		}
	}
	payload := map[string]any{"board": b, "permissions": sh.Permissions}
	encoded, err := json.Marshal(payload)
	if err != nil {
		writeErr(w, 500, "读取看板失败")
		return
	}
	sum := sha256.Sum256(encoded)
	version := hex.EncodeToString(sum[:])
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Get("version") == version {
		writeOK(w, map[string]any{"version": version, "unchanged": true})
		return
	}
	payload["version"] = version
	writeOK(w, payload)
}
func (s *Server) handleSharedCard(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	c, err := s.sharedCard(sh, pathID(r, "id"))
	if err != nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	sanitizeSharedCard(c, sh)
	writeOK(w, c)
}
func (s *Server) handleSharedEdit(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	id := pathID(r, "id")
	if _, err := s.sharedCard(sh, id); err != nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	var req struct {
		Pinned      *bool   `json:"pinned"`
		Cover       *string `json:"cover"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		DueDate     *string `json:"due_date"`
	}
	if shareDecode(r, &req) != nil || (req.Title != nil && (strings.TrimSpace(*req.Title) == "" || len(*req.Title) > 1000)) {
		writeErr(w, 400, "请求格式不正确")
		return
	}
	if req.Title == nil && req.Description == nil && req.DueDate == nil && req.Pinned == nil && req.Cover == nil {
		writeErr(w, 400, "请求格式不正确")
		return
	}
	if (req.Title != nil || req.Description != nil || req.DueDate != nil) && !requireShare(w, sh.Permissions.Edit) {
		return
	}
	if req.Pinned != nil && !requireShare(w, sh.Permissions.Pin) {
		return
	}
	if req.Cover != nil && !requireShare(w, sh.Permissions.Cover) {
		return
	}
	if req.Cover != nil && *req.Cover != "" {
		if len(*req.Cover) != 7 || (*req.Cover)[0] != '#' {
			writeErr(w, 400, "请求格式不正确")
			return
		}
		for _, ch := range (*req.Cover)[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", ch) {
				writeErr(w, 400, "请求格式不正确")
				return
			}
		}
	}
	if req.DueDate != nil && *req.DueDate != "" {
		if _, err := time.Parse("2006-01-02", *req.DueDate); err != nil {
			writeErr(w, 400, "日期格式不正确")
			return
		}
	}
	c, err := s.store.UpdateCard(id, CardPatch{Pinned: req.Pinned, Cover: req.Cover, Title: req.Title, Description: req.Description, DueDate: req.DueDate})
	if err != nil {
		writeErr(w, 500, "更新失败")
		return
	}
	s.store.logActivity(sh.BoardID, id, 0, "分享访客", "updated", "更新卡片内容")
	s.publishCard(id, "")
	sanitizeSharedCard(c, sh)
	writeOK(w, c)
}
func (s *Server) handleSharedMove(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	if !requireShare(w, sh.Permissions.Move) {
		return
	}
	id := pathID(r, "id")
	if _, err := s.sharedCard(sh, id); err != nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	var req struct {
		ColumnID int64 `json:"column_id"`
		BeforeID int64 `json:"before_id"`
	}
	if shareDecode(r, &req) != nil {
		writeErr(w, 400, "移动参数不正确")
		return
	}
	bid, err := s.store.boardIDByColumn(req.ColumnID)
	if err != nil || bid != sh.BoardID {
		writeErr(w, 403, "只能在当前看板移动卡片")
		return
	}
	if req.BeforeID != 0 {
		c, e := s.sharedCard(sh, req.BeforeID)
		if e != nil || c.ColumnID != req.ColumnID || c.ID == id {
			writeErr(w, 400, "目标位置不正确")
			return
		}
	}
	c, err := s.store.MoveCard(id, req.ColumnID, req.BeforeID)
	if err != nil {
		writeErr(w, 400, "移动失败")
		return
	}
	s.store.logActivity(sh.BoardID, id, 0, "分享访客", "moved", "移动卡片")
	s.publishCard(id, "")
	sanitizeSharedCard(c, sh)
	writeOK(w, c)
}
func (s *Server) handleSharedCreate(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	if !requireShare(w, sh.Permissions.Create) {
		return
	}
	col := pathID(r, "id")
	bid, err := s.store.boardIDByColumn(col)
	if err != nil || bid != sh.BoardID {
		writeErr(w, 404, "列表不存在")
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	if shareDecode(r, &req) != nil || strings.TrimSpace(req.Title) == "" || len(req.Title) > 1000 {
		writeErr(w, 400, "请填写卡片标题（最多 1000 字节）")
		return
	}
	c, err := s.store.CreateCard(col, strings.TrimSpace(req.Title), 0)
	if err != nil {
		writeErr(w, 500, "创建失败")
		return
	}
	s.store.logActivity(sh.BoardID, c.ID, 0, "分享访客", "created", c.Title)
	s.publishCard(c.ID, "")
	writeJSON(w, 201, c)
}
func (s *Server) handleSharedItem(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	if !requireShare(w, sh.Permissions.Checklist) {
		return
	}
	id := pathID(r, "id")
	list, err := s.store.itemChecklist(id)
	if err != nil {
		writeErr(w, 404, "清单项不存在")
		return
	}
	card, err := s.store.checklistCard(list)
	if err != nil {
		writeErr(w, 404, "清单项不存在")
		return
	}
	if _, err = s.sharedCard(sh, card); err != nil {
		writeErr(w, 404, "清单项不存在")
		return
	}
	var req struct {
		Done *bool `json:"done"`
	}
	if shareDecode(r, &req) != nil || req.Done == nil {
		writeErr(w, 400, "仅允许勾选清单项")
		return
	}
	if err = s.store.UpdateChecklistItem(id, "", req.Done); err != nil {
		writeErr(w, 500, "更新失败")
		return
	}
	s.publishCard(card, "")
	writeOK(w, nil)
}
func (s *Server) handleSharedDownload(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	if !requireShare(w, sh.Permissions.Download) {
		return
	}
	a, err := s.store.GetAttachment(pathID(r, "id"))
	if err != nil {
		writeErr(w, 404, "附件不存在")
		return
	}
	if _, err = s.sharedCard(sh, a.CardID); err != nil {
		writeErr(w, 404, "附件不存在")
		return
	}
	s.serveAttachment(w, r, a, r.URL.Query().Get("preview") == "1")
}
func (s *Store) comments(cardID int64) ([]Comment, error) {
	rows, err := s.db.Query("SELECT id,card_id,author,content,created_at FROM card_comments WHERE card_id=? ORDER BY id DESC LIMIT 200", cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err = rows.Scan(&c.ID, &c.CardID, &c.Author, &c.Content, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Server) handleSharedComments(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	id := pathID(r, "id")
	if _, err := s.sharedCard(sh, id); err != nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	if r.Method == "POST" && !requireShare(w, sh.Permissions.Comment) {
		return
	}
	s.cardComments(w, r, id, false)
}
func (s *Server) handleAdminComments(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	id := pathID(r, "id")
	if _, err := s.store.GetCard(id); err != nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	s.cardComments(w, r, id, true)
}
func (s *Server) cardComments(w http.ResponseWriter, r *http.Request, id int64, admin bool) {
	if r.Method == "POST" {
		var req struct {
			Author  string `json:"author"`
			Content string `json:"content"`
		}
		if shareDecode(r, &req) != nil || strings.TrimSpace(req.Content) == "" || len(req.Content) > 12000 || len(req.Author) > 120 {
			writeErr(w, 400, "评论不能为空，内容最多 12000 字节，昵称最多 120 字节")
			return
		}
		author := "访客"
		if strings.TrimSpace(req.Author) != "" {
			author = strings.TrimSpace(req.Author)
		}
		if admin {
			user := currentUser(r)
			role := "管理员"
			if user.Role == "workspace_admin" {
				role = "子管理员"
			} else if user.Role == "member" {
				role = "成员"
			}
			author = user.DisplayName + "（" + role + "）"
		} else {
			author += "（访客）"
		}
		if _, err := s.store.db.Exec("INSERT INTO card_comments(card_id,author,content,created_at) VALUES(?,?,?,?)", id, author, strings.TrimSpace(req.Content), nowISO()); err != nil {
			writeErr(w, 500, "发送失败")
			return
		}
		s.publishCard(id, "")
	}
	comments, err := s.store.comments(id)
	if err != nil {
		writeErr(w, 500, "读取评论失败")
		return
	}
	writeOK(w, comments)
}
func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	var card int64
	if err := s.store.db.QueryRow("SELECT card_id FROM card_comments WHERE id=?", pathID(r, "id")).Scan(&card); err != nil {
		writeErr(w, 404, "评论不存在")
		return
	}
	if _, err := s.store.db.Exec("DELETE FROM card_comments WHERE id=?", pathID(r, "id")); err != nil {
		writeErr(w, 500, "删除失败")
		return
	}
	s.publishCard(card, "")
	writeOK(w, nil)
}

// 管理列表不返回访问密钥；复制时按需读取对应分享记录。
func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	type entry struct {
		BoardShare
		BoardName string `json:"board_name"`
		Active    bool   `json:"active"`
		Sessions  int    `json:"sessions"`
	}
	rows, err := s.store.db.Query(`SELECT sh.id,sh.board_id,b.name,sh.enabled,sh.expires_at,sh.permissions,sh.name,sh.created_at,b.archived,
   (SELECT COUNT(*) FROM share_sessions ss WHERE ss.share_id=sh.id AND ss.expires_at>?)
   FROM board_shares sh JOIN boards b ON b.id=sh.board_id
 WHERE (?='admin' OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=b.workspace_id AND w.owner_id=?) OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=b.workspace_id AND m.user_id=?)) AND (?=0 OR b.workspace_id=?)
 ORDER BY sh.created_at DESC, sh.id DESC`, nowISO(), currentUser(r).Role, currentUser(r).ID, currentUser(r).ID, parseInt64(r.URL.Query().Get("workspace_id")), parseInt64(r.URL.Query().Get("workspace_id")))
	if err != nil {
		writeErr(w, 500, "读取分享链接失败，请重试")
		return
	}
	defer rows.Close()
	out := []entry{}
	for rows.Next() {
		var e entry
		var enabled, archived int
		var permissions string
		if err = rows.Scan(&e.ID, &e.BoardID, &e.BoardName, &enabled, &e.ExpiresAt, &permissions, &e.Name, &e.CreatedAt, &archived, &e.Sessions); err != nil {
			writeErr(w, 500, "读取分享链接失败")
			return
		}
		if err = json.Unmarshal([]byte(permissions), &e.Permissions); err != nil {
			writeErr(w, 500, "读取分享权限失败")
			return
		}
		e.Enabled = enabled == 1
		e.BoardArchived = archived == 1
		e.Active = e.BoardShare.active() && !e.BoardArchived
		if !e.Active {
			e.Sessions = 0
		}
		out = append(out, e)
	}
	if err = rows.Err(); err != nil {
		writeErr(w, 500, "读取分享链接失败")
		return
	}
	writeOK(w, out)
}
