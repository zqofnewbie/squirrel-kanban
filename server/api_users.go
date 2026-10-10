package main

import (
	"net/http"
	"strings"
)

// 注意：系统不提供注册接口，账号只能由超级管理员在此创建。

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取用户失败")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
		Role        string `json:"role"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		writeErr(w, http.StatusBadRequest, "登录名不能为空")
		return
	}
	if len(req.Password) < 4 {
		writeErr(w, http.StatusBadRequest, "密码至少 4 位")
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		req.DisplayName = req.Username
	}
	if err := s.store.CreateUser(req.Username, req.DisplayName, req.Password, req.Role, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	users, _ := s.store.ListUsers()
	writeJSON(w, http.StatusCreated, users)
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	me := currentUser(r)
	var req struct {
		DisplayName *string `json:"display_name"`
		Role        string  `json:"role"`
		Password    string  `json:"password"`
		Disabled    *bool   `json:"disabled"`
		MustChange  *bool   `json:"must_change_password"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if id == me.ID && req.Disabled != nil && *req.Disabled {
		writeErr(w, http.StatusBadRequest, "不能停用当前登录的账号")
		return
	}
	if req.Password != "" && len(req.Password) < 4 {
		writeErr(w, http.StatusBadRequest, "密码至少 4 位")
		return
	}
	if err := s.store.UpdateUser(id, derefStr(req.DisplayName), req.Role, req.Password, req.Disabled, req.MustChange); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	users, _ := s.store.ListUsers()
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	me := currentUser(r)
	if id == me.ID {
		writeErr(w, http.StatusBadRequest, "不能删除当前登录的账号")
		return
	}
	if err := s.store.DeleteUser(id); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	users, _ := s.store.ListUsers()
	writeJSON(w, http.StatusOK, users)
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
