package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestBoardOrderPersistenceAndScope(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("owner", "Owner", "test-password", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureSingleAdmin(); err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(1, "")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	a, _ := s.CreateBoard("A", "", "", 1)
	b, _ := s.CreateBoard("B", "", "", 1)
	srv := &Server{store: s, hub: NewHub(), dataDir: t.TempDir()}
	h := srv.routes()
	payload := fmt.Sprintf(`{"workspace_id":1,"ids":[%d,%d]}`, a.ID, b.ID)
	mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", payload, nil), 401)
	mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", payload, cookie), 200)
	s.TouchBoard(b.ID)
	result := apiCall(t, h, "GET", "/api/boards?workspace_id=1", "", cookie)
	mustStatus(t, result, 200)
	var boards []Board
	json.Unmarshal(result.Body.Bytes(), &boards)
	if len(boards) != 2 || boards[0].ID != a.ID {
		t.Fatal("saved order changed after editing")
	}
	bad := fmt.Sprintf(`{"workspace_id":1,"ids":[%d,%d]}`, b.ID, b.ID)
	mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", bad, cookie), 400)
	result = apiCall(t, h, "GET", "/api/boards?workspace_id=1", "", cookie)
	json.Unmarshal(result.Body.Bytes(), &boards)
	if boards[0].ID != a.ID {
		t.Fatal("failed request partially saved")
	}
	mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", fmt.Sprintf(`{"workspace_id":999,"ids":[%d]}`, a.ID), cookie), 403)
	if err := s.CreateUser("member", "Member", "test-password", "workspace_admin", false); err != nil {
		t.Fatal(err)
	}
	member, _ := s.Authenticate("member", "test-password")
	ms, _ := s.CreateSession(member.ID, "")
	mustStatus(t, apiCall(t, h, "PUT", "/api/board-order", payload, &http.Cookie{Name: cookieName, Value: ms.Token}), 403)
	order := []Board{*b, *a}
	if err := s.sortUserBoards(member.ID, order); err != nil || order[0].ID != b.ID {
		t.Fatal("user order leaked")
	}
}
