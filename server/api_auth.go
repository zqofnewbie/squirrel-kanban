package main

import (
	"net/http"
	"strings"
)

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type passwordReq struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	var req loginReq
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	u, err := s.store.Authenticate(req.Username, req.Password)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, mapErr(err))
		return
	}
	if u.Role == "admin" {
		if err := s.store.ensureWelcomeBoard(u.ID, r.Header.Get("Accept-Language")); err != nil {
			writeErr(w, 500, "创建模板看板失败，请重试")
			return
		}
	}
	sess, err := s.store.CreateSession(u.ID, r.UserAgent())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建会话失败")
		return
	}
	setSessionCookie(w, sess.Token)
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "actor": sess.Actor})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !validOrigin(w, r) {
		return
	}
	if c, err := r.Cookie(cookieName); err == nil {
		s.store.DeleteSession(c.Value)
	}
	clearSessionCookie(w)
	writeOK(w, nil)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.IsAdmin() {
		if err := s.store.ensureWelcomeBoard(u.ID, r.Header.Get("Accept-Language")); err != nil {
			writeErr(w, 500, "创建模板看板失败，请重试")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u.User, "actor": u.Actor})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req passwordReq
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 72 {
		writeErr(w, http.StatusBadRequest, "新密码需要 8–72 位")
		return
	}
	if _, err := s.store.Authenticate(u.Username, req.OldPassword); err != nil {
		writeErr(w, http.StatusBadRequest, "当前密码不正确")
		return
	}
	if err := s.store.UpdateUser(u.ID, "", "", req.NewPassword, nil, boolPtr(false)); err != nil {
		writeErr(w, http.StatusInternalServerError, "修改失败")
		return
	}
	writeOK(w, nil)
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		DisplayName string `json:"display_name"`
		AvatarColor string `json:"avatar_color"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName != "" {
		if err := s.store.UpdateUser(u.ID, req.DisplayName, "", "", nil, nil); err != nil {
			writeErr(w, http.StatusInternalServerError, "更新失败")
			return
		}
	}
	if req.AvatarColor != "" {
		s.store.db.Exec("UPDATE users SET avatar_color=? WHERE id=?", req.AvatarColor, u.ID)
	}
	nu, err := s.store.GetUser(u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取用户失败")
		return
	}
	writeJSON(w, http.StatusOK, nu)
}
