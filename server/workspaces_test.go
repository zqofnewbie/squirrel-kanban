package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceAuthorizationAndMembershipLifecycle(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("owner", "超级管理员", "owner-password", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureSingleAdmin(); err != nil {
		t.Fatal(err)
	}
	a, _ := s.CreateSession(1, "")
	owner := &http.Cookie{Name: cookieName, Value: a.Token}
	srv := &Server{store: s, hub: NewHub(), dataDir: t.TempDir()}
	h := srv.routes()
	created := apiCall(t, h, "POST", "/api/workspaces", `{"name":"团队空间","description":"独立工作"}`, owner)
	mustStatus(t, created, 200)
	var ws Workspace
	json.Unmarshal(created.Body.Bytes(), &ws)
	response := apiCall(t, h, "POST", "/api/users", fmt.Sprintf(`{"username":"delegate","display_name":"子管理员","password":"delegate-password","workspace_ids":[%d]}`, ws.ID), owner)
	mustStatus(t, response, 200)
	var result map[string]int64
	json.Unmarshal(response.Body.Bytes(), &result)
	uid := result["id"]
	member, err := s.Authenticate("delegate", "delegate-password")
	if err != nil || member.Role != "workspace_admin" {
		t.Fatalf("delegate cannot login: %v", err)
	}
	sess, _ := s.CreateSession(uid, "")
	cookie := &http.Cookie{Name: cookieName, Value: sess.Token}
	// Restart migration must preserve newly authorized users and their assignments.
	if err = s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", cookie), 200)
	workspaces := apiCall(t, h, "GET", "/api/workspaces", "", cookie)
	mustStatus(t, workspaces, 200)
	var visible []Workspace
	json.Unmarshal(workspaces.Body.Bytes(), &visible)
	if len(visible) != 1 || visible[0].ID != ws.ID {
		t.Fatal("workspace list leaked")
	}
	own, _ := s.CreateBoard("授权看板", "", "", ws.ID)
	other, _ := s.CreateBoard("私有看板", "", "", 1)
	od, _ := s.GetBoardDetail(own.ID)
	pd, _ := s.GetBoardDetail(other.ID)
	oc, _ := s.CreateCard(od.Columns[0].ID, "授权任务", uid)
	pc, _ := s.CreateCard(pd.Columns[0].ID, "私有任务", 1)
	cl, _ := s.CreateChecklist(pc.ID, "私有清单")
	item, _ := s.CreateChecklistItem(cl.ID, "任务")
	att, _ := s.CreateAttachment(pc.ID, "secret.pdf", "/files/secret.pdf", 1)
	label, _ := s.CreateLabel(other.ID, "私有标签", "#123456")
	commentResult, err := s.db.Exec("INSERT INTO card_comments(card_id,author,content,created_at) VALUES(?,?,?,?)", pc.ID, "所有者", "私有意见", nowISO())
	if err != nil {
		t.Fatal(err)
	}
	comment, _ := commentResult.LastInsertId()
	boards := apiCall(t, h, "GET", "/api/boards", "", cookie)
	mustStatus(t, boards, 200)
	var list []Board
	json.Unmarshal(boards.Body.Bytes(), &list)
	if len(list) != 1 || list[0].ID != own.ID {
		t.Fatal("board list leaked")
	}
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", own.ID), "", cookie), 200)
	denied := []struct{ method, path, body string }{
		{"GET", fmt.Sprintf("/api/boards/%d", other.ID), ""},
		{"GET", fmt.Sprintf("/api/cards/%d", pc.ID), ""},
		{"GET", fmt.Sprintf("/api/cards/%d/activities", pc.ID), ""},
		{"GET", fmt.Sprintf("/api/cards/%d/comments", pc.ID), ""},
		{"PATCH", fmt.Sprintf("/api/columns/%d", pd.Columns[0].ID), `{"name":"bad"}`},
		{"PATCH", fmt.Sprintf("/api/labels/%d", label.ID), `{"name":"bad"}`},
		{"PATCH", fmt.Sprintf("/api/checklists/%d", cl.ID), `{"title":"bad"}`},
		{"PATCH", fmt.Sprintf("/api/items/%d", item.ID), `{"done":true}`},
		{"GET", fmt.Sprintf("/api/attachments/%d/preview", att.ID), ""},
		{"GET", "/files/secret.pdf", ""},
		{"DELETE", fmt.Sprintf("/api/comments/%d", comment), ""},
		{"GET", fmt.Sprintf("/api/events?board_id=%d", other.ID), ""},
		{"GET", "/api/events", ""},
		{"POST", "/api/users", `{"username":"escalate","password":"password-123","workspace_ids":[1]}`},
		{"PATCH", fmt.Sprintf("/api/workspaces/%d", ws.ID), `{"name":"越权修改"}`},
		{"POST", "/api/boards", `{"name":"越权看板","workspace_id":1}`},
		{"POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"越权分享","enabled":true}`, other.ID)},
	}
	for _, test := range denied {
		t.Run(test.method+test.path, func(t *testing.T) { mustStatus(t, apiCall(t, h, test.method, test.path, test.body, cookie), 403) })
	}
	mustStatus(t, apiCall(t, h, "POST", fmt.Sprintf("/api/cards/%d/move", oc.ID), fmt.Sprintf(`{"column_id":%d}`, pd.Columns[0].ID), cookie), 400)
	if err = s.ToggleCardLabel(oc.ID, label.ID, true); err == nil {
		t.Fatal("cross board label allowed")
	}
	mustStatus(t, apiCall(t, h, "POST", fmt.Sprintf("/api/cards/%d/move", oc.ID), fmt.Sprintf(`{"column_id":%d,"before_id":%d}`, od.Columns[0].ID, pc.ID), cookie), 400)
	ownShare := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"授权分享","enabled":false}`, own.ID), cookie)
	mustStatus(t, ownShare, 201)
	privateShare := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"私有分享","enabled":false}`, other.ID), owner)
	mustStatus(t, privateShare, 201)
	var secret BoardShare
	json.Unmarshal(privateShare.Body.Bytes(), &secret)
	for _, method := range []string{"GET", "PATCH", "DELETE"} {
		mustStatus(t, apiCall(t, h, method, "/api/shares/"+secret.ID, `{"name":"bad"}`, cookie), 403)
	}
	shared := apiCall(t, h, "GET", "/api/shares", "", cookie)
	mustStatus(t, shared, 200)
	var shares []BoardShare
	json.Unmarshal(shared.Body.Bytes(), &shares)
	if len(shares) != 1 || shares[0].BoardID != own.ID {
		t.Fatal("share list leaked")
	}
	// Invalid allocation rolls back; protected owner cannot be edited or deleted.
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", uid), `{"display_name":"不应保存","workspace_ids":[999999]}`, owner), 400)
	saved, _ := s.GetUser(uid)
	if saved.DisplayName != "子管理员" {
		t.Fatal("invalid allocation partially saved")
	}
	mustStatus(t, apiCall(t, h, "PATCH", "/api/users/1", `{"display_name":"bad"}`, owner), 403)
	mustStatus(t, apiCall(t, h, "DELETE", "/api/users/1", "", owner), 403)
	mustStatus(t, apiCall(t, h, "POST", "/api/users", `{"username":"another-owner","password":"password-123","role":"admin"}`, owner), 400)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/workspaces/%d", ws.ID), "", owner), 409)
	// Removing the assignment invalidates old sessions, including after relogin.
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", uid), `{"display_name":"子管理员","workspace_ids":[]}`, owner), 200)
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", own.ID), "", cookie), 401)
	fresh, _ := s.CreateSession(uid, "")
	cookie.Value = fresh.Token
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", own.ID), "", cookie), 403)
	empty := apiCall(t, h, "GET", "/api/boards", "", cookie)
	if empty.Body.String() != "[]\n" {
		t.Fatal("unassigned user can list boards")
	}
	// Account removal preserves cards and historical authorship.
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/users/%d", uid), "", owner), 200)
	if card, err := s.GetCard(oc.ID); err != nil || card.Title != "授权任务" {
		t.Fatal("deleting user destroyed card")
	}
}

func TestWorkspaceMigrationWithExistingBoards(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	old, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = old.Exec(schemaSQL); err != nil {
		t.Fatal(err)
	}
	if _, err = old.Exec("INSERT INTO boards(id,name,description,background,created_at,updated_at) VALUES(17,'原有看板','原有描述','#F7F9FC','2026-01-01','2026-01-01'); INSERT INTO board_columns(id,board_id,name,position) VALUES(25,17,'待办',1024); INSERT INTO cards(id,column_id,title,position,created_at,updated_at) VALUES(31,25,'原有任务',1024,'2026-01-01','2026-01-01')"); err != nil {
		t.Fatal(err)
	}
	old.Close()
	migrated, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	board, err := migrated.GetBoardDetail(17)
	if err != nil || board.WorkspaceID != 1 || board.Description != "原有描述" || board.Columns[0].Cards[0].ID != 31 {
		t.Fatalf("migration changed existing data: %v", err)
	}
	if _, err = migrated.db.Exec("UPDATE boards SET workspace_id=999 WHERE id=17"); err == nil {
		t.Fatal("invalid workspace accepted")
	}
	if _, err = migrated.db.Exec("DELETE FROM workspaces WHERE id=1"); err == nil {
		t.Fatal("nonempty workspace deleted")
	}
	migrated.Close()
	again, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	var count int
	again.db.QueryRow("SELECT COUNT(*) FROM boards").Scan(&count)
	if count != 1 {
		t.Fatal("restart duplicated boards")
	}
}

func TestWorkspaceEventsDoNotLeakAndStopAfterRevocation(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("delegate", "子管理员", "password-123", "workspace_admin", false); err != nil {
		t.Fatal(err)
	}
	s.db.Exec("INSERT INTO workspace_members(workspace_id,user_id) VALUES(1,1)")
	board, err := s.CreateBoard("授权看板", "", "")
	if err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(1, "")
	srv := &Server{store: s, hub: NewHub(), dataDir: t.TempDir()}
	ts := httptest.NewServer(srv.routes())
	defer ts.Close()
	request, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/events?board_id=%d", ts.URL, board.ID), nil)
	request.AddCookie(&http.Cookie{Name: cookieName, Value: session.Token})
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), "hello") {
			break
		}
	}
	srv.publish(0, "other", "board.list", map[string]string{"name": "PRIVATE_NAME_MUST_NOT_LEAK"})
	srv.publish(board.ID, "other", "board.structure", nil)
	found := false
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "PRIVATE_NAME") {
			t.Fatal("global event leaked private payload")
		}
		if strings.Contains(line, "board.structure") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("allowed event missing: %v", scanner.Err())
	}
	s.DeleteSession(session.Token)
	srv.publish(board.ID, "other", "card.updated", map[string]string{"title": "AFTER_REVOCATION"})
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), "AFTER_REVOCATION") {
			t.Fatal("revoked stream still receives data")
		}
	}
	if scanner.Err() != nil {
		t.Fatalf("revoked stream was not closed: %v", scanner.Err())
	}
}

func TestOwnedWorkspacesSurviveAssignmentChanges(t *testing.T) {
	s := testStore(t)
	for _, u := range []struct{ name, role string }{{"root", "admin"}, {"child", "workspace_admin"}, {"other", "workspace_admin"}} {
		if err := s.CreateUser(u.name, u.name, "test-password", u.role, false); err != nil {
			t.Fatal(err)
		}
	}
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	cookie := func(id int64) *http.Cookie {
		session, err := s.CreateSession(id, "")
		if err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: cookieName, Value: session.Token}
	}
	root, child, other := cookie(1), cookie(2), cookie(3)
	rec := apiCall(t, h, "POST", "/api/workspaces", `{"name":"Child space"}`, child)
	mustStatus(t, rec, 200)
	var space Workspace
	json.Unmarshal(rec.Body.Bytes(), &space)
	if space.OwnerID != 2 || !space.CanManage {
		t.Fatalf("missing ownership: %+v", space)
	}
	path := fmt.Sprintf("/api/workspaces/%d", space.ID)
	mustStatus(t, apiCall(t, h, "PATCH", path, `{"name":"Renamed"}`, child), 200)
	mustStatus(t, apiCall(t, h, "PATCH", path, `{"name":"Denied"}`, other), 403)
	mustStatus(t, apiCall(t, h, "DELETE", path, "", other), 403)
	rec = apiCall(t, h, "POST", "/api/boards", fmt.Sprintf(`{"name":"Owned board","workspace_id":%d}`, space.ID), child)
	mustStatus(t, rec, 201)
	var board Board
	json.Unmarshal(rec.Body.Bytes(), &board)
	rec = apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"name":"Owned share","board_id":%d,"enabled":true,"permissions":{}}`, board.ID), child)
	mustStatus(t, rec, 201)
	rec = apiCall(t, h, "GET", "/api/shares", "", child)
	mustStatus(t, rec, 200)
	if !strings.Contains(rec.Body.String(), "Owned share") {
		t.Fatal("owned share omitted")
	}
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", board.ID), "", other), 403)
	mustStatus(t, apiCall(t, h, "PATCH", "/api/users/2", `{"display_name":"child","disabled":false,"workspace_ids":[]}`, root), 200)
	child = cookie(2)
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", board.ID), "", child), 200)
	mustStatus(t, apiCall(t, h, "DELETE", path, "", child), 409)
	mustStatus(t, apiCall(t, h, "PATCH", "/api/workspaces/1", `{"name":"No"}`, child), 403)
	mustStatus(t, apiCall(t, h, "DELETE", "/api/users/2", "", root), 200)
	// Deleting an account keeps its workspace and content under super-administrator control.
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", board.ID), "", root), 200)
	var owner sql.NullInt64
	s.db.QueryRow("SELECT owner_id FROM workspaces WHERE id=?", space.ID).Scan(&owner)
	if owner.Valid {
		t.Fatal("deleted owner's ID retained")
	}
}

func TestFreshInstallAndEnglishBoardDefaults(t *testing.T) {
	s := testStore(t)
	t.Setenv("KANBAN_ADMIN_USER", "fresh")
	t.Setenv("KANBAN_ADMIN_PASS", "fresh-password")
	if err := s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	if len(boards) != 0 {
		t.Fatal("fresh install must be empty")
	}
	user, err := s.Authenticate("fresh", "fresh-password")
	if err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(user.ID, "")
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	r := httptest.NewRequest("POST", "/api/boards", strings.NewReader(`{"name":"English board"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept-Language", "en-US")
	r.AddCookie(&http.Cookie{Name: cookieName, Value: session.Token})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	mustStatus(t, w, 201)
	var b Board
	json.Unmarshal(w.Body.Bytes(), &b)
	detail, _ := s.GetBoardDetail(b.ID)
	if len(detail.Columns) != 3 || detail.Columns[0].Name != "To do" || detail.Columns[2].Name != "Done" {
		t.Fatal("incorrect English defaults")
	}
	if err = s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	boards, _ = s.ListBoards()
	if len(boards) != 1 {
		t.Fatal("restart changed board data")
	}
}
