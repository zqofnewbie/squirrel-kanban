package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func finishInitialPassword(t *testing.T, h http.Handler, cookie *http.Cookie, old string) {
	t.Helper()
	mustStatus(t, apiCall(t, h, "PATCH", "/api/auth/password", fmt.Sprintf(`{"old_password":%q,"new_password":"changed-test-password"}`, old), cookie), 200)
}

func TestInitialPasswordAndSessionRevocation(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("owner", "Owner", "initial-password", "admin", true); err != nil {
		t.Fatal(err)
	}
	s.ensureSingleAdmin()
	first, _ := s.CreateSession(1, "")
	second, _ := s.CreateSession(1, "")
	a := &http.Cookie{Name: cookieName, Value: first.Token}
	b := &http.Cookie{Name: cookieName, Value: second.Token}
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", a), 200)
	mustStatus(t, apiCall(t, h, "POST", "/api/workspaces", `{"name":"blocked"}`, a), 403)
	finishInitialPassword(t, h, a, "initial-password")
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", a), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/auth/me", "", b), 401)
	mustStatus(t, apiCall(t, h, "POST", "/api/workspaces", `{"name":"allowed"}`, a), 200)
}

func TestLoginLimitWindowAndSpoofedForwarding(t *testing.T) {
	l := loginLimiter{}
	now := time.Now()
	r := httptest.NewRequest("POST", "/api/auth/login", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	for i := 0; i < 10; i++ {
		if !l.allow(r, now) {
			t.Fatal("early rate limit")
		}
	}
	r.Header.Set("X-Forwarded-For", "203.0.113.1")
	if l.allow(r, now) {
		t.Fatal("forwarded address bypassed rate limit")
	}
	if !l.allow(r, now.Add(time.Minute)) {
		t.Fatal("window did not expire")
	}
}

func TestReleaseCardValidationAndBoardDescription(t *testing.T) {
	s := testStore(t)
	s.CreateUser("owner", "Owner", "initial-password", "admin", false)
	s.ensureSingleAdmin()
	session, _ := s.CreateSession(1, "")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	board, _ := s.CreateBoard("Test", "clear me", "")
	detail, _ := s.GetBoardDetail(board.ID)
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	path := fmt.Sprintf("/api/columns/%d/cards", detail.Columns[0].ID)
	for _, body := range []string{`{`, `{} {}`, `{"title":""}`, fmt.Sprintf(`{"title":%q}`, strings.Repeat("中", 251))} {
		mustStatus(t, apiCall(t, h, "POST", path, body, cookie), 400)
	}
	mustStatus(t, apiCall(t, h, "POST", path, fmt.Sprintf(`{"title":%q}`, strings.Repeat("中", 250)), cookie), 201)
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/boards/%d", board.ID), `{"description":""}`, cookie), 200)
	updated, _ := s.GetBoard(board.ID)
	if updated.Description != "" {
		t.Fatal("description was not cleared")
	}
	for _, role := range []string{"workspace_admin", "member"} {
		s.CreateUser(role, role, "initial-password", role, false)
		u, _ := s.Authenticate(role, "initial-password")
		sess, _ := s.CreateSession(u.ID, "")
		c := &http.Cookie{Name: cookieName, Value: sess.Token}
		payload := fmt.Sprintf(`{"workspace_id":1,"ids":[%d]}`, board.ID)
		mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", payload, c), 403)
		if _, err := s.db.Exec("INSERT INTO workspace_members(workspace_id,user_id) VALUES(1,?)", u.ID); err != nil {
			t.Fatal(err)
		}
		mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", payload, c), 200)
	}
}

func TestSharedAndAdminValidationParity(t *testing.T) {
	s := testStore(t)
	s.CreateUser("owner", "Owner", "initial-password", "admin", false)
	s.ensureSingleAdmin()
	session, _ := s.CreateSession(1, "")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	board, _ := s.CreateBoard("Test", "", "")
	detail, _ := s.GetBoardDetail(board.ID)
	card, _ := s.CreateCard(detail.Columns[0].ID, "Original", 1)
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	result := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"Test","enabled":true,"permissions":{"edit":true,"cover":true,"create":true}}`, board.ID), cookie)
	mustStatus(t, result, 201)
	var share BoardShare
	json.Unmarshal(result.Body.Bytes(), &share)
	base := "/api/shared/" + share.ShortKey
	sessionResult := apiCall(t, h, "POST", base+"/session", `{}`, nil)
	mustStatus(t, sessionResult, 200)
	guest := sessionResult.Result().Cookies()[0]
	for _, title := range []string{strings.Repeat("中", 250), strings.Repeat("a", 250), strings.Repeat("🐿", 250), strings.Repeat("中", 251), " "} {
		want := 200
		if strings.TrimSpace(title) == "" || len([]rune(title)) > 250 {
			want = 400
		}
		body := fmt.Sprintf(`{"title":%q}`, title)
		mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/cards/%d", card.ID), body, cookie), want)
		mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("%s/cards/%d", base, card.ID), body, guest), want)
	}
	for _, body := range []string{`{"cover":"red"}`, `{"due_date":"2026-02-30"}`, fmt.Sprintf(`{"description":%q}`, strings.Repeat("中", 20001))} {
		mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/cards/%d", card.ID), body, cookie), 400)
		mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("%s/cards/%d", base, card.ID), body, guest), 400)
	}
}
func TestLoginHTTPRateLimit(t *testing.T) {
	s := testStore(t)
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	for i := 0; i < 10; i++ {
		mustStatus(t, apiCall(t, h, "POST", "/api/auth/login", `{"username":"missing","password":"wrong"}`, nil), 401)
	}
	result := apiCall(t, h, "POST", "/api/auth/login", `{"username":"missing","password":"wrong"}`, nil)
	mustStatus(t, result, 429)
	if result.Header().Get("Retry-After") == "" {
		t.Fatal("missing retry guidance")
	}
}
