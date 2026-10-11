package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
)

type Workspace struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	BoardCount  int    `json:"board_count"`
	OwnerID     int64  `json:"owner_id"`
	CanManage   bool   `json:"can_manage"`
	CreatedAt   string `json:"created_at"`
	CreatorName string `json:"creator_name"`
}

func (s *Store) migrateWorkspaces() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`CREATE TABLE IF NOT EXISTS workspaces(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_members(workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS user_managers(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL);
 CREATE INDEX IF NOT EXISTS idx_workspace_user ON workspace_members(user_id,workspace_id);
 INSERT OR IGNORE INTO workspaces(id,name,created_at) VALUES(1,'默认工作空间',datetime('now'));`)
	if err != nil {
		return err
	}
	rows, err := tx.Query("PRAGMA table_info(boards)")
	if err != nil {
		return err
	}
	exists := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var def any
		if err = rows.Scan(&cid, &name, &kind, &notnull, &def, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "workspace_id" {
			exists = true
		}
	}
	rows.Close()
	if !exists {
		if _, err = tx.Exec("ALTER TABLE boards ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1"); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("CREATE INDEX IF NOT EXISTS idx_boards_workspace ON boards(workspace_id)"); err != nil {
		return err
	}
	_, err = tx.Exec(`CREATE TRIGGER IF NOT EXISTS boards_workspace_insert BEFORE INSERT ON boards WHEN NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'workspace does not exist'); END;
 CREATE TRIGGER IF NOT EXISTS boards_workspace_update BEFORE UPDATE OF workspace_id ON boards WHEN NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'workspace does not exist'); END;
 CREATE TRIGGER IF NOT EXISTS workspace_delete_restrict BEFORE DELETE ON workspaces WHEN EXISTS(SELECT 1 FROM boards WHERE workspace_id=OLD.id) BEGIN SELECT RAISE(ABORT,'workspace is not empty'); END;`)
	if err != nil {
		return err
	}
	rows, err = tx.Query("PRAGMA table_info(workspaces)")
	if err != nil {
		return err
	}
	ownerExists := false
	creatorExists := false
	for rows.Next() {
		var cid, nn, pk int
		var name, kind string
		var def any
		if err = rows.Scan(&cid, &name, &kind, &nn, &def, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "creator_name" {
			creatorExists = true
		}
		if name == "owner_id" {
			ownerExists = true
		}
	}
	rows.Close()
	if !ownerExists {
		if _, err = tx.Exec("ALTER TABLE workspaces ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL"); err != nil {
			return err
		}
	}
	if !creatorExists {
		if _, err = tx.Exec("ALTER TABLE workspaces ADD COLUMN creator_name TEXT NOT NULL DEFAULT ''"); err != nil {
			return err
		}
		if _, err = tx.Exec("UPDATE workspaces SET creator_name=COALESCE((SELECT display_name FROM users WHERE id=workspaces.owner_id),'')"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) canWorkspace(u *AuthUser, id int64) bool {
	if u == nil || id <= 0 {
		return false
	}
	n, err := s.queryInt(`SELECT COUNT(*) FROM workspaces w WHERE w.id=? AND (?='admin' OR w.owner_id=? OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=?))`, id, u.Role, u.ID, u.ID)
	return err == nil && n == 1
}
func (s *Store) canBoard(u *AuthUser, id int64) bool {
	if u == nil || id <= 0 {
		return false
	}
	n, err := s.queryInt(`SELECT COUNT(*) FROM boards b WHERE b.id=? AND (?='admin' OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=b.workspace_id AND w.owner_id=?) OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=b.workspace_id AND m.user_id=?))`, id, u.Role, u.ID, u.ID)
	return err == nil && n == 1
}

// Resolve ownership from the stored resource, never a caller-supplied workspace ID.
func (s *Server) allowResource(r *http.Request, u *AuthUser) bool {
	if u.IsAdmin() {
		return true
	}
	path := r.URL.Path
	if path == "/api/users" || strings.HasPrefix(path, "/api/users/") {
		return u.Role == "workspace_admin"
	}
	if strings.HasPrefix(path, "/api/auth/") || path == "/api/workspaces" || path == "/api/boards" || path == "/api/shares" {
		return true
	}
	if path == "/api/events" {
		return s.store.canBoard(u, parseInt64(r.URL.Query().Get("board_id")))
	}
	id := pathID(r, "id")
	var bid int64
	var err error
	switch {
	case strings.HasPrefix(path, "/api/workspaces/"):
		return s.store.canWorkspace(u, id)
	case strings.HasPrefix(path, "/api/boards/"):
		bid = id
	case strings.HasPrefix(path, "/api/columns/"):
		bid, err = s.store.boardIDByColumn(id)
	case strings.HasPrefix(path, "/api/cards/"):
		bid, err = s.store.boardIDByCard(id)
	case strings.HasPrefix(path, "/api/labels/"):
		err = s.store.db.QueryRow("SELECT board_id FROM labels WHERE id=?", id).Scan(&bid)
	case strings.HasPrefix(path, "/api/checklists/"):
		err = s.store.db.QueryRow("SELECT col.board_id FROM checklists cl JOIN cards c ON c.id=cl.card_id JOIN board_columns col ON col.id=c.column_id WHERE cl.id=?", id).Scan(&bid)
	case strings.HasPrefix(path, "/api/items/"):
		err = s.store.db.QueryRow("SELECT col.board_id FROM checklist_items i JOIN checklists cl ON cl.id=i.checklist_id JOIN cards c ON c.id=cl.card_id JOIN board_columns col ON col.id=c.column_id WHERE i.id=?", id).Scan(&bid)
	case strings.HasPrefix(path, "/api/attachments/"):
		err = s.store.db.QueryRow("SELECT col.board_id FROM attachments a JOIN cards c ON c.id=a.card_id JOIN board_columns col ON col.id=c.column_id WHERE a.id=?", id).Scan(&bid)
	case strings.HasPrefix(path, "/files/"):
		err = s.store.db.QueryRow("SELECT col.board_id FROM attachments a JOIN cards c ON c.id=a.card_id JOIN board_columns col ON col.id=c.column_id WHERE a.path=?", path).Scan(&bid)
	case strings.HasPrefix(path, "/api/comments/"):
		err = s.store.db.QueryRow("SELECT col.board_id FROM card_comments a JOIN cards c ON c.id=a.card_id JOIN board_columns col ON col.id=c.column_id WHERE a.id=?", id).Scan(&bid)
	case strings.HasPrefix(path, "/api/shares/"):
		err = s.store.db.QueryRow("SELECT board_id FROM board_shares WHERE id=?", r.PathValue("sid")).Scan(&bid)
	default:
		return false
	}
	return err == nil && s.store.canBoard(u, bid)
}

func (s *Server) workspaceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/workspaces", s.withAuth(s.handleWorkspaces))
	mux.HandleFunc("POST /api/workspaces", s.withAuth(s.handleWorkspaces))
	mux.HandleFunc("PATCH /api/workspaces/{id}", s.withAuth(s.handleWorkspaces))
	mux.HandleFunc("DELETE /api/workspaces/{id}", s.withAuth(s.handleWorkspaces))
	mux.HandleFunc("GET /api/users", s.withAuth(s.handleUsers))
	mux.HandleFunc("POST /api/users", s.withAuth(s.handleUsers))
	mux.HandleFunc("PATCH /api/users/{id}", s.withAuth(s.handleUsers))
	mux.HandleFunc("DELETE /api/users/{id}", s.withAuth(s.handleUsers))
}
func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		u := currentUser(r)
		rows, err := s.store.db.Query(`SELECT w.id,w.name,w.description,COALESCE(w.owner_id,0),w.created_at,w.creator_name,(SELECT COUNT(*) FROM boards b WHERE b.workspace_id=w.id AND b.archived=0) FROM workspaces w WHERE ?='admin' OR w.owner_id=? OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=?) ORDER BY w.id`, u.Role, u.ID, u.ID)
		if err != nil {
			writeErr(w, 500, "读取工作空间失败")
			return
		}
		defer rows.Close()
		out := []Workspace{}
		for rows.Next() {
			var item Workspace
			if err = rows.Scan(&item.ID, &item.Name, &item.Description, &item.OwnerID, &item.CreatedAt, &item.CreatorName, &item.BoardCount); err != nil {
				writeErr(w, 500, "读取工作空间失败")
				return
			}
			item.CanManage = u.IsAdmin() || (u.Role == "workspace_admin" && item.OwnerID == u.ID)
			out = append(out, item)
		}
		writeOK(w, out)
		return
	}
	id := pathID(r, "id")
	u := currentUser(r)
	if u.Role == "member" {
		writeErr(w, 403, "成员不能创建或管理工作空间")
		return
	}
	if r.Method != "POST" && !u.IsAdmin() {
		var ownerID sql.NullInt64
		if s.store.db.QueryRow("SELECT owner_id FROM workspaces WHERE id=?", id).Scan(&ownerID) != nil || !ownerID.Valid || ownerID.Int64 != u.ID {
			writeErr(w, 403, "只能管理自己创建的工作空间")
			return
		}
	}
	if r.Method == "DELETE" {
		if id == 1 {
			writeErr(w, 400, "默认工作空间不能删除，可以重命名")
			return
		}
		tx, err := s.store.db.Begin()
		if err != nil {
			writeErr(w, 500, "删除失败")
			return
		}
		defer tx.Rollback()
		var count int
		err = tx.QueryRow("SELECT COUNT(*) FROM boards WHERE workspace_id=?", id).Scan(&count)
		if err != nil {
			writeErr(w, 500, "删除失败")
			return
		}
		if count > 0 {
			writeErr(w, 409, "请先处理空间内的看板，非空空间不能删除")
			return
		}
		result, err := tx.Exec("DELETE FROM workspaces WHERE id=?", id)
		if err != nil {
			writeErr(w, 500, "删除失败")
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			writeErr(w, 404, "空间不存在")
			return
		}
		if tx.Commit() != nil {
			writeErr(w, 500, "删除失败")
			return
		}
		writeOK(w, nil)
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if decode(r, &req) != nil || len([]rune(strings.TrimSpace(req.Name))) == 0 || len([]rune(req.Name)) > 60 {
		writeErr(w, 400, "空间名称需要 1–60 个字")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if r.Method == "POST" {
		result, err := s.store.db.Exec("INSERT INTO workspaces(name,description,created_at,owner_id,creator_name) VALUES(?,?,?,?,?)", req.Name, req.Description, nowISO(), u.ID, u.DisplayName)
		if err != nil {
			writeErr(w, 500, "创建空间失败")
			return
		}
		id, _ = result.LastInsertId()
	} else {
		result, err := s.store.db.Exec("UPDATE workspaces SET name=?,description=? WHERE id=?", req.Name, req.Description, id)
		if err != nil {
			writeErr(w, 500, "更新空间失败")
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			writeErr(w, 404, "空间不存在")
			return
		}
	}
	var ownerID int64
	var createdAt, creatorName string
	s.store.db.QueryRow("SELECT COALESCE(owner_id,0),created_at,creator_name FROM workspaces WHERE id=?", id).Scan(&ownerID, &createdAt, &creatorName)
	writeOK(w, Workspace{ID: id, Name: req.Name, Description: req.Description, OwnerID: ownerID, CreatedAt: createdAt, CreatorName: creatorName, CanManage: u.IsAdmin() || ownerID == u.ID})
}

type ManagedUser struct {
	User
	WorkspaceIDs      []int64 `json:"workspace_ids"`
	OwnedWorkspaceIDs []int64 `json:"owned_workspace_ids"`
	ManagerID         int64   `json:"manager_id"`
	ManagerName       string  `json:"manager_name"`
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	if !actor.IsAdmin() && actor.Role != "workspace_admin" {
		writeErr(w, 403, "没有成员管理权限")
		return
	}
	if r.Method == "GET" {
		users, err := s.store.ListUsers()
		if err != nil {
			writeErr(w, 500, "读取账号失败")
			return
		}
		out := []ManagedUser{}
		for _, u := range users {
			if !actor.IsAdmin() {
				n, _ := s.store.queryInt("SELECT COUNT(*) FROM user_managers WHERE user_id=? AND manager_id=?", u.ID, actor.ID)
				if u.Role != "member" || n != 1 {
					continue
				}
			}
			item := ManagedUser{User: u, WorkspaceIDs: []int64{}, OwnedWorkspaceIDs: []int64{}}
			if u.Role == "member" {
				s.store.db.QueryRow("SELECT u.id,u.display_name FROM user_managers m JOIN users u ON u.id=m.manager_id WHERE m.user_id=? AND u.role='workspace_admin'", u.ID).Scan(&item.ManagerID, &item.ManagerName)
			}
			rows, e := s.store.db.Query("SELECT workspace_id,0 FROM workspace_members WHERE user_id=? UNION ALL SELECT id,1 FROM workspaces WHERE owner_id=? ORDER BY 1", u.ID, u.ID)
			if e != nil {
				writeErr(w, 500, "读取分配失败")
				return
			}
			for rows.Next() {
				var id int64
				var owned bool
				if rows.Scan(&id, &owned) == nil {
					if owned {
						item.OwnedWorkspaceIDs = append(item.OwnedWorkspaceIDs, id)
					} else {
						item.WorkspaceIDs = append(item.WorkspaceIDs, id)
					}
				}
			}
			rows.Close()
			out = append(out, item)
		}
		writeOK(w, out)
		return
	}
	id := pathID(r, "id")
	if id != 0 {
		u, err := s.store.GetUser(id)
		if err != nil {
			writeErr(w, 404, "用户不存在")
			return
		}
		if !actor.IsAdmin() {
			n, _ := s.store.queryInt("SELECT COUNT(*) FROM user_managers WHERE user_id=? AND manager_id=?", id, actor.ID)
			if u.Role != "member" || n != 1 {
				writeErr(w, 403, "只能管理归属自己的成员")
				return
			}
		}
		if u.Role == "admin" {
			writeErr(w, 403, "超级管理员账号请使用个人设置管理")
			return
		}
	}
	if r.Method == "DELETE" {
		if s.store.DeleteUser(id) != nil {
			writeErr(w, 500, "删除失败")
			return
		}
		writeOK(w, nil)
		return
	}
	var req struct {
		Username          string  `json:"username"`
		DisplayName       string  `json:"display_name"`
		Password          string  `json:"password"`
		Role              string  `json:"role"`
		Disabled          bool    `json:"disabled"`
		WorkspaceIDs      []int64 `json:"workspace_ids"`
		OwnedWorkspaceIDs []int64 `json:"owned_workspace_ids"`
		ManagerID         *int64  `json:"manager_id"`
	}
	if decode(r, &req) != nil {
		writeErr(w, 400, "请求格式不正确")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.Role == "" {
		req.Role = "workspace_admin"
		if !actor.IsAdmin() {
			req.Role = "member"
		}
	}
	if !actor.IsAdmin() && req.Role != "member" {
		writeErr(w, 403, "子管理员只能创建和管理成员")
		return
	}
	if req.Role != "member" && req.Role != "workspace_admin" {
		writeErr(w, 400, "只能分配子管理员或成员角色")
		return
	}
	if len([]rune(req.DisplayName)) > 60 || (id == 0 && (req.Username == "" || len(req.Username) > 80)) {
		writeErr(w, 400, "请填写有效的账号名称")
		return
	}
	if (id == 0 || req.Password != "") && (len(req.Password) < 8 || len(req.Password) > 72) {
		writeErr(w, 400, "密码需要 8–72 位")
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	if req.DisplayName == "" {
		writeErr(w, 400, "显示名称不能为空")
		return
	}
	hash := ""
	var err error
	if req.Password != "" {
		hash, err = hashPassword(req.Password)
		if err != nil {
			writeErr(w, 500, "密码处理失败")
			return
		}
	}
	tx, err := s.store.db.Begin()
	if err != nil {
		writeErr(w, 500, "保存失败")
		return
	}
	defer tx.Rollback()
	if req.ManagerID != nil {
		if !actor.IsAdmin() {
			writeErr(w, 403, "只有超级管理员可以调整成员归属")
			return
		}
		if req.Role != "member" || *req.ManagerID < 0 {
			writeErr(w, 400, "仅成员可以设置管理归属")
			return
		}
		if *req.ManagerID != 0 {
			var n int
			if tx.QueryRow("SELECT COUNT(*) FROM users WHERE id=? AND role='workspace_admin' AND (disabled=0 OR id=(SELECT manager_id FROM user_managers WHERE user_id=?))", *req.ManagerID, id).Scan(&n) != nil || n != 1 {
				writeErr(w, 400, "请选择有效的子管理员")
				return
			}
		}
	}
	if id != 0 && !actor.IsAdmin() {
		var n int
		if tx.QueryRow("SELECT COUNT(*) FROM user_managers m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.manager_id=? AND u.role='member'", id, actor.ID).Scan(&n) != nil || n != 1 {
			writeErr(w, 403, "只能管理归属自己的成员")
			return
		}
	}
	seen := map[int64]bool{}
	for _, wid := range req.WorkspaceIDs {
		if seen[wid] {
			continue
		}
		seen[wid] = true
		if !actor.IsAdmin() {
			var owner int64
			if tx.QueryRow("SELECT COALESCE(owner_id,0) FROM workspaces WHERE id=?", wid).Scan(&owner) != nil || owner != actor.ID {
				writeErr(w, 403, "只能分配自己创建的工作空间")
				return
			}
		}
		var n int
		if tx.QueryRow("SELECT COUNT(*) FROM workspaces WHERE id=?", wid).Scan(&n) != nil || n != 1 {
			writeErr(w, 400, "分配的工作空间不存在")
			return
		}
	}
	if id == 0 {
		var result sql.Result
		result, err = tx.Exec("INSERT INTO users(username,display_name,password_hash,role,avatar_color,disabled,must_change,created_at) VALUES(?,?,?,?,?,?,1,?)", req.Username, req.DisplayName, hash, req.Role, pickColor(req.Username), boolInt(req.Disabled), nowISO())
		if err == nil {
			id, _ = result.LastInsertId()
			_, err = tx.Exec("INSERT INTO user_managers(user_id,manager_id) VALUES(?,?)", id, actor.ID)
		}
	} else {
		_, err = tx.Exec("UPDATE users SET display_name=?,role=?,disabled=? WHERE id=?", req.DisplayName, req.Role, boolInt(req.Disabled), id)
		if err == nil && hash != "" {
			_, err = tx.Exec("UPDATE users SET password_hash=?,must_change=1 WHERE id=?", hash, id)
		}
	}
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, 409, "登录名已存在")
		} else {
			writeErr(w, 500, "保存账号失败")
		}
		return
	}
	if req.ManagerID != nil {
		if _, err = tx.Exec("INSERT INTO user_managers(user_id,manager_id) VALUES(?,NULLIF(?,0)) ON CONFLICT(user_id) DO UPDATE SET manager_id=excluded.manager_id", id, *req.ManagerID); err != nil {
			writeErr(w, 500, "保存归属失败")
			return
		}
	}
	if req.Role == "member" {
		if _, err = tx.Exec("UPDATE workspaces SET owner_id=NULL WHERE owner_id=?", id); err != nil {
			writeErr(w, 500, "保存分配失败")
			return
		}
	}
	deleteMembership := "DELETE FROM workspace_members WHERE user_id=?"
	args := []any{id}
	if !actor.IsAdmin() {
		deleteMembership += " AND workspace_id IN (SELECT id FROM workspaces WHERE owner_id=?)"
		args = append(args, actor.ID)
	}
	if _, err = tx.Exec(deleteMembership, args...); err != nil {
		writeErr(w, 500, "保存分配失败")
		return
	}
	for wid := range seen {
		if _, err = tx.Exec("INSERT OR IGNORE INTO workspace_members(workspace_id,user_id) VALUES(?,?)", wid, id); err != nil {
			writeErr(w, 500, "保存分配失败")
			return
		}
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", id); err != nil {
		writeErr(w, 500, "更新会话失败")
		return
	}
	if tx.Commit() != nil {
		writeErr(w, 500, "保存失败")
		return
	}
	writeOK(w, map[string]int64{"id": id})
}

var errScope = errors.New("目标不属于当前看板")
