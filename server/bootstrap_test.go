package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProductionBootstrapPassword(t *testing.T) {
	s := testStore(t)
	for _, password := range []string{"", "admin", "            ", "请替换为你的初始密码"} {
		t.Setenv("KANBAN_ADMIN_PASS", password)
		if s.validateBootstrap(false) == nil {
			t.Fatal("unsafe production bootstrap accepted")
		}
	}
	if err := s.validateBootstrap(true); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KANBAN_ADMIN_PASS", "test-only-strong-password")
	if err := s.validateBootstrap(false); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KANBAN_ADMIN_PASS", "")
	if err := s.validateBootstrap(false); err != nil {
		t.Fatal("existing installation blocked", err)
	}
}

func TestHealthAndSecureCookies(t *testing.T) {
	s := testStore(t)
	h := (&Server{store: s}).routes()
	mustStatus(t, apiCall(t, h, "GET", "/healthz", "", nil), 200)
	t.Setenv("KANBAN_COOKIE_SECURE", "true")
	for _, writeCookie := range []func(http.ResponseWriter){func(w http.ResponseWriter) { setSessionCookie(w, "test") }, clearSessionCookie} {
		w := httptest.NewRecorder()
		writeCookie(w)
		c := w.Result().Cookies()[0]
		if !c.Secure || !c.HttpOnly {
			t.Fatal("missing secure cookie flags")
		}
	}
	s.Close()
	mustStatus(t, apiCall(t, h, "GET", "/healthz", "", nil), 503)
}
