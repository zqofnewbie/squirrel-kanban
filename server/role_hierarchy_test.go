package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoleHierarchyAndCollaborationFlow(t *testing.T) {
	s := testStore(t)
	s.CreateUser("root", "Root", "root-password", "admin", false)
	s.ensureSingleAdmin()
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	login := func(id int64) *http.Cookie {
		session, _ := s.CreateSession(id, "")
		cookie := &http.Cookie{Name: cookieName, Value: session.Token}
		user, _ := s.GetUser(id)
		if user.MustChange {
			finishInitialPassword(t, h, cookie, "test-password")
		}
		return cookie
	}
	root := login(1)
	create := func(cookie *http.Cookie, name, role string, spaces string) int64 {
		r := apiCall(t, h, "POST", "/api/users", fmt.Sprintf(`{"username":%q,"display_name":%q,"password":"test-password","role":%q,"workspace_ids":%s}`, name, name, role, spaces), cookie)
		mustStatus(t, r, 200)
		var v map[string]int64
		json.Unmarshal(r.Body.Bytes(), &v)
		return v["id"]
	}
	managerID := create(root, "manager", "workspace_admin", "[]")
	manager := login(managerID)
	otherID := create(root, "other", "workspace_admin", "[]")
	other := login(otherID)
	r := apiCall(t, h, "POST", "/api/workspaces", `{"name":"Team"}`, manager)
	mustStatus(t, r, 200)
	var ws Workspace
	json.Unmarshal(r.Body.Bytes(), &ws)
	memberID := create(manager, "child", "member", fmt.Sprintf("[%d]", ws.ID))
	member := login(memberID)
	outsider := create(other, "outside", "member", "[]")
	r = apiCall(t, h, "GET", "/api/users", "", manager)
	mustStatus(t, r, 200)
	var users []ManagedUser
	json.Unmarshal(r.Body.Bytes(), &users)
	if len(users) != 1 || users[0].ID != memberID {
		t.Fatal("manager sees unrelated users")
	}
	for _, id := range []int64{1, managerID, otherID, outsider} {
		for _, method := range []string{"PATCH", "DELETE"} {
			mustStatus(t, apiCall(t, h, method, fmt.Sprintf("/api/users/%d", id), `{"role":"member","display_name":"bad"}`, manager), 403)
		}
	}
	mustStatus(t, apiCall(t, h, "POST", "/api/users", `{"role":"workspace_admin","username":"bad","password":"test-password"}`, manager), 403)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", memberID), `{"role":"member","display_name":"Child","workspace_ids":[1]}`, manager), 403)
	mustStatus(t, apiCall(t, h, "GET", "/api/users", "", member), 403)
	mustStatus(t, apiCall(t, h, "POST", "/api/workspaces", `{"name":"No"}`, member), 403)
	r = apiCall(t, h, "POST", "/api/boards", fmt.Sprintf(`{"name":"Team board","workspace_id":%d}`, ws.ID), member)
	mustStatus(t, r, 201)
	var b Board
	json.Unmarshal(r.Body.Bytes(), &b)
	board, _ := s.GetBoardDetail(b.ID)
	r = apiCall(t, h, "POST", fmt.Sprintf("/api/columns/%d/cards", board.Columns[0].ID), `{"title":"Task"}`, member)
	mustStatus(t, r, 201)
	var c Card
	json.Unmarshal(r.Body.Bytes(), &c)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/cards/%d", c.ID), `{"title":"Updated","pinned":true}`, member), 200)
	r = apiCall(t, h, "POST", fmt.Sprintf("/api/cards/%d/comments", c.ID), `{"content":"Member comment"}`, member)
	mustStatus(t, r, 200)
	r = apiCall(t, h, "GET", fmt.Sprintf("/api/cards/%d/comments", c.ID), "", member)
	mustStatus(t, r, 200)
	if !strings.Contains(r.Body.String(), "child（成员）") {
		t.Fatal("incorrect member comment role", r.Body.String())
	}
	r = apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"Review","enabled":true,"permissions":{"edit":true}}`, b.ID), member)
	mustStatus(t, r, 201)
	var sh BoardShare
	json.Unmarshal(r.Body.Bytes(), &sh)
	r = apiCall(t, h, "POST", "/api/shared/"+sh.ID+"/session", fmt.Sprintf(`{"key":%q}`, sh.Key), nil)
	mustStatus(t, r, 200)
	guest := r.Result().Cookies()[0]
	readBoard := func(version string) map[string]json.RawMessage {
		r := apiCall(t, h, "GET", "/api/shared/"+sh.ID+"/board?version="+version, "", guest)
		mustStatus(t, r, 200)
		var data map[string]json.RawMessage
		json.Unmarshal(r.Body.Bytes(), &data)
		return data
	}
	initial := readBoard("")
	var version string
	json.Unmarshal(initial["version"], &version)
	if version == "" || initial["board"] == nil {
		t.Fatal("missing initial shared board")
	}
	unchanged := readBoard(version)
	if string(unchanged["unchanged"]) != "true" || unchanged["board"] != nil {
		t.Fatal("unchanged board sent again")
	}

	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/shared/%s/cards/%d", sh.ID, c.ID), `{"description":"Guest update"}`, guest), 200)
	if readBoard(version)["board"] == nil {
		t.Fatal("card mutation did not invalidate version")
	}
	changed := readBoard("")
	var latest string
	json.Unmarshal(changed["version"], &latest)
	_, err := s.db.Exec("UPDATE board_shares SET permissions=? WHERE id=?", `{"edit":true,"comment":true}`, sh.ID)
	if err != nil {
		t.Fatal(err)
	}
	if readBoard(latest)["permissions"] == nil {
		t.Fatal("permission change did not invalidate version")
	}
	// Cached versions must never bypass permission/session checks.
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+sh.ID+"/board?version="+version, "", nil), 403)

	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/shared/%s/cards/%d", sh.ID, c.ID), `{"pinned":false}`, guest), 403)
	mustStatus(t, apiCall(t, h, "GET", "/api/users", "", guest), 401)

	// Transfer management without dropping existing workspace access.
	transfer := func(owner int64, actor *http.Cookie) *httptest.ResponseRecorder {
		return apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", memberID), fmt.Sprintf(`{"role":"member","display_name":"Child","workspace_ids":[%d],"manager_id":%d}`, ws.ID, owner), actor)
	}
	mustStatus(t, transfer(otherID, manager), 403)
	mustStatus(t, transfer(memberID, root), 400)
	mustStatus(t, transfer(otherID, root), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", member), 401)
	member = login(memberID)
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", b.ID), "", member), 200)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/users/%d", memberID), "", manager), 403)
	r = apiCall(t, h, "GET", "/api/users", "", other)
	mustStatus(t, r, 200)
	json.Unmarshal(r.Body.Bytes(), &users)
	found := false
	for _, u := range users {
		if u.ID == memberID {
			found = true
			if u.ManagerID != otherID || u.ManagerName != "other" {
				t.Fatal("missing ownership metadata")
			}
		}
	}
	if !found {
		t.Fatal("new manager cannot see transferred member")
	}
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", memberID), `{"role":"member","display_name":"Child","workspace_ids":[]}`, other), 200)
	member = login(memberID)
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("/api/boards/%d", b.ID), "", member), 200)
	mustStatus(t, transfer(0, root), 200)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/users/%d", memberID), "", other), 403)
	mustStatus(t, transfer(managerID, root), 200)
	member = login(memberID)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/users/%d", memberID), fmt.Sprintf(`{"role":"member","display_name":"Child","disabled":true,"workspace_ids":[%d]}`, ws.ID), manager), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", member), 401)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/users/%d", memberID), "", manager), 200)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/users/%d", outsider), "", root), 200)
}
