package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestMemberRoleScopeAndRestart(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("owner", "Owner", "owner-password", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureSingleAdmin(); err != nil {
		t.Fatal(err)
	}
	a, _ := s.CreateSession(1, "")
	admin := &http.Cookie{Name: cookieName, Value: a.Token}
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	r := apiCall(t, h, "POST", "/api/users", `{"username":"member","display_name":"Member","password":"member-password","role":"member","workspace_ids":[1]}`, admin)
	mustStatus(t, r, 200)
	var id map[string]int64
	json.Unmarshal(r.Body.Bytes(), &id)
	u, err := s.Authenticate("member", "member-password")
	if err != nil || u.Role != "member" {
		t.Fatalf("member login: %v", err)
	}
	sess, _ := s.CreateSession(id["id"], "")
	member := &http.Cookie{Name: cookieName, Value: sess.Token}
	finishInitialPassword(t, h, member, "member-password")
	if err = s.ensureSingleAdmin(); err != nil {
		t.Fatal(err)
	}
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", member), 200)
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		path := "/api/workspaces"
		if method != "POST" {
			path += "/1"
		}
		mustStatus(t, apiCall(t, h, method, path, `{"name":"Forbidden"}`, member), 403)
	}
	mustStatus(t, apiCall(t, h, "GET", "/api/users", "", member), 403)
	b, _ := s.CreateBoard("Allowed", "", "", 1)
	d, _ := s.GetBoardDetail(b.ID)
	mustStatus(t, apiCall(t, h, "POST", fmt.Sprintf("/api/columns/%d/cards", d.Columns[0].ID), `{"title":"Member task"}`, member), 201)
	mustStatus(t, apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"Member share","enabled":true,"permissions":{}}`, b.ID), member), 201)
	ws := apiCall(t, h, "POST", "/api/workspaces", `{"name":"Private"}`, admin)
	mustStatus(t, ws, 200)
	var private Workspace
	json.Unmarshal(ws.Body.Bytes(), &private)
	hidden, _ := s.CreateBoard("Hidden", "", "", private.ID)
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", hidden.ID), "", member), 403)
	// A role change revokes sessions and cannot retain ownership-based access.
	s.db.Exec("UPDATE workspaces SET owner_id=? WHERE id=?", u.ID, private.ID)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", u.ID), `{"display_name":"Member","role":"member","workspace_ids":[1]}`, admin), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", member), 401)
	if s.canWorkspace(&AuthUser{User: *u}, private.ID) {
		t.Fatal("member retained unassigned owned space")
	}
}
