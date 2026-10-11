package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const cookieName = "kanban_session"

type ctxKey struct{}

// AuthUser 是放进请求上下文的已登录用户。
type AuthUser struct {
	User
	Actor string
}

func (a *AuthUser) IsAdmin() bool { return a.Role == "admin" }

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validOrigin(w, r) {
			return
		}
		u, err := s.userFromRequest(r)
		if err != nil || u == nil {
			writeErr(w, http.StatusUnauthorized, mapErr(err))
			return
		}
		if !s.allowResource(r, u) {
			writeErr(w, http.StatusForbidden, "没有这个工作空间的访问权限")
			return
		}
		ctx := context.WithValue(r.Context(), ctxKey{}, u)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.withAuth(func(w http.ResponseWriter, r *http.Request) {
		u := currentUser(r)
		if u == nil || !u.IsAdmin() {
			writeErr(w, http.StatusForbidden, "需要超级管理员权限")
			return
		}
		next(w, r)
	})
}

func (s *Server) userFromRequest(r *http.Request) (*AuthUser, error) {
	token := ""
	if c, err := r.Cookie(cookieName); err == nil {
		token = c.Value
	}

	u, actor, err := s.store.SessionUser(token)
	if err != nil {
		return nil, err
	}
	return &AuthUser{User: *u, Actor: actor}, nil
}

func currentUser(r *http.Request) *AuthUser {
	u, _ := r.Context().Value(ctxKey{}).(*AuthUser)
	return u
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   envBool("KANBAN_COOKIE_SECURE"),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   envBool("KANBAN_COOKIE_SECURE"),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func mapErr(err error) string {
	switch err {
	case ErrBadCredentials:
		return "用户名或密码不正确"
	case ErrDisabled:
		return "账号已被停用，请联系管理员"
	}
	return "未登录"
}

// ---------- HTTP 响应小工具 ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeOK(w http.ResponseWriter, v any) {
	if v == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeJSON(w, http.StatusOK, v)
}
