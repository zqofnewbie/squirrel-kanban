package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrBadCredentials = errors.New("用户名或密码不正确")
	ErrDisabled       = errors.New("账号已被停用")
	ErrUserExists     = errors.New("登录名已存在")
	ErrLastAdmin      = errors.New("至少保留一个超级管理员")
)

func hashPassword(p string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	return string(b), err
}

func checkPassword(hash, p string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(p)) == nil
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

var avatarPalette = []string{
	"#7F77DD", "#1D9E75", "#D85A30", "#378ADD", "#D4537E",
	"#BA7517", "#639922", "#E24B4A", "#888780", "#534AB7",
}

func pickColor(seed string) string {
	var sum int
	for _, r := range seed {
		sum += int(r)
	}
	return avatarPalette[sum%len(avatarPalette)]
}

// ---------- 初始化 ----------

func (s *Store) ensureSeed() error {
	n, err := s.queryInt("SELECT COUNT(*) FROM users")
	if err != nil {
		return err
	}
	if n > 0 {
		return s.ensureSingleAdmin()
	}
	username := envOr("KANBAN_ADMIN_USER", "admin")
	password := envOr("KANBAN_ADMIN_PASS", "admin")
	if err := s.CreateUser(username, username, password, "admin", true); err != nil {
		return err
	}
	return s.ensureSingleAdmin()
}

func (s *Store) createStarterBoard(adminID int64) error {
	now := nowISO()
	res, err := s.db.Exec(
		`INSERT INTO boards(name, description, background, created_at, updated_at)
		 VALUES(?,?,?,?,?)`,
		"我的第一个看板", "把想法变成卡片，把计划一步步完成。", "#F7F9FC", now, now)
	if err != nil {
		return err
	}
	boardID, _ := res.LastInsertId()
	names := []string{"待办", "进行中", "已完成"}
	firstCol := int64(0)
	for i, name := range names {
		res, err := s.db.Exec(
			`INSERT INTO board_columns(board_id, name, position) VALUES(?,?,?)`,
			boardID, name, float64((i+1)*1024))
		if err != nil {
			return err
		}
		if i == 0 {
			firstCol, _ = res.LastInsertId()
		}
	}
	labelDefs := [][2]string{
		{"需求", "#7F77DD"}, {"缺陷", "#E24B4A"},
		{"设计", "#378ADD"}, {"优化", "#1D9E75"},
	}
	for i, l := range labelDefs {
		if _, err := s.db.Exec(
			`INSERT INTO labels(board_id, name, color, position) VALUES(?,?,?,?)`,
			boardID, l[0], l[1], float64((i+1)*1024)); err != nil {
			return err
		}
	}
	samples := []string{"点击卡片右上角的编辑按钮改标题", "试着把我拖到「进行中」", "点开卡片看详情、清单和附件"}
	for i, t := range samples {
		if _, err := s.db.Exec(
			`INSERT INTO cards(column_id, title, position, created_by, created_at, updated_at)
			 VALUES(?,?,?,?,?,?)`, firstCol, t, float64((i+1)*1024), adminID, now, now); err != nil {
			return err
		}
	}
	return nil
}

// ---------- 用户 ----------

func (s *Store) CreateUser(username, displayName, password, role string, mustChange bool) error {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return errors.New("登录名和密码不能为空")
	}
	if role != "admin" && role != "member" && role != "workspace_admin" {
		role = "member"
	}
	if displayName == "" {
		displayName = username
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO users(username, display_name, password_hash, role, avatar_color, must_change, created_at)
		 VALUES(?,?,?,?,?,?,?)`,
		username, displayName, hash, role, pickColor(username), boolInt(mustChange), nowISO())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrUserExists
		}
		return err
	}
	return nil
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(
		`SELECT u.id, u.username, u.display_name, u.role, u.avatar_color, u.disabled,
		        u.must_change, u.created_at, COALESCE(u.last_login_at,''),
		        (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at > ?)
		 FROM users u ORDER BY u.id`, nowISO())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		var disabled, must int
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.AvatarColor,
			&disabled, &must, &u.CreatedAt, &u.LastLoginAt, &u.SessionCount); err != nil {
			return nil, err
		}
		u.Disabled = disabled == 1
		u.MustChange = must == 1
		out = append(out, u)
	}
	return out, nil
}

func (s *Store) UpdateUser(id int64, displayName, role string, password string, disabled *bool, mustChange *bool) error {
	u, err := s.GetUser(id)
	if err != nil {
		return err
	}
	if displayName != "" {
		if _, err := s.db.Exec("UPDATE users SET display_name=? WHERE id=?", displayName, id); err != nil {
			return err
		}
	}
	if role != "" && role != u.Role {
		if u.Role == "admin" && role != "admin" {
			n, _ := s.queryInt("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0")
			if n <= 1 {
				return ErrLastAdmin
			}
		}
		if _, err := s.db.Exec("UPDATE users SET role=? WHERE id=?", role, id); err != nil {
			return err
		}
	}
	if password != "" {
		hash, err := hashPassword(password)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec("UPDATE users SET password_hash=?, must_change=1 WHERE id=?", hash, id); err != nil {
			return err
		}
	}
	if disabled != nil {
		if *disabled && u.Role == "admin" {
			n, _ := s.queryInt("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0")
			if n <= 1 {
				return ErrLastAdmin
			}
		}
		if _, err := s.db.Exec("UPDATE users SET disabled=? WHERE id=?", boolInt(*disabled), id); err != nil {
			return err
		}
		if *disabled {
			s.db.Exec("DELETE FROM sessions WHERE user_id=?", id)
		}
	}
	if mustChange != nil {
		if _, err := s.db.Exec("UPDATE users SET must_change=? WHERE id=?", boolInt(*mustChange), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteUser(id int64) error {
	u, err := s.GetUser(id)
	if err != nil {
		return err
	}
	if u.Role == "admin" {
		n, _ := s.queryInt("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0")
		if n <= 1 {
			return ErrLastAdmin
		}
	}
	_, err = s.db.Exec("DELETE FROM users WHERE id=?", id)
	return err
}

func (s *Store) GetUser(id int64) (*User, error) {
	var u User
	var disabled, must int
	err := s.db.QueryRow(
		`SELECT id, username, display_name, role, avatar_color, disabled, must_change,
		        created_at, COALESCE(last_login_at,'') FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.AvatarColor,
			&disabled, &must, &u.CreatedAt, &u.LastLoginAt)
	if err != nil {
		return nil, err
	}
	u.Disabled = disabled == 1
	u.MustChange = must == 1
	return &u, nil
}

func (s *Store) Authenticate(username, password string) (*User, error) {
	var u User
	var hash string
	var disabled int
	err := s.db.QueryRow(
		`SELECT id, username, display_name, role, avatar_color, disabled, must_change,
		        created_at, COALESCE(last_login_at,''), password_hash
		 FROM users WHERE username=?`, strings.TrimSpace(username)).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.AvatarColor,
			&disabled, &u.MustChange, &u.CreatedAt, &u.LastLoginAt, &hash)
	if err == sql.ErrNoRows || !checkPassword(hash, password) {
		return nil, ErrBadCredentials
	}
	if err != nil {
		return nil, err
	}
	if disabled == 1 || (u.Role != "admin" && u.Role != "workspace_admin" && u.Role != "member") {
		return nil, ErrDisabled
	}
	u.Disabled = false
	return &u, nil
}

// ---------- 会话 ----------

type Session struct {
	Token   string
	UserID  int64
	Actor   string
	Expires time.Time
}

func (s *Store) CreateSession(userID int64, ua string) (*Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	actor, err := randomToken(8)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	exp := now.AddDate(0, 0, 30)
	_, err = s.db.Exec(
		`INSERT INTO sessions(token, user_id, actor, created_at, expires_at, last_seen_at, user_agent)
		 VALUES(?,?,?,?,?,?,?)`,
		token, userID, actor, now.Format(time.RFC3339), exp.Format(time.RFC3339),
		now.Format(time.RFC3339), trunc(ua, 200))
	if err != nil {
		return nil, err
	}
	s.db.Exec("UPDATE users SET last_login_at=? WHERE id=?", now.Format(time.RFC3339), userID)
	return &Session{Token: token, UserID: userID, Actor: actor, Expires: exp}, nil
}

func (s *Store) SessionUser(token string) (*User, string, error) {
	if token == "" {
		return nil, "", ErrBadCredentials
	}
	var u User
	var actor string
	var disabled int
	err := s.db.QueryRow(
		`SELECT u.id, u.username, u.display_name, u.role, u.avatar_color, u.disabled,
		        u.must_change, u.created_at, COALESCE(u.last_login_at,''), s.actor
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token=? AND s.expires_at > ?`, token, nowISO()).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.AvatarColor,
			&disabled, &u.MustChange, &u.CreatedAt, &u.LastLoginAt, &actor)
	if err != nil {
		return nil, "", ErrBadCredentials
	}
	if disabled == 1 || (u.Role != "admin" && u.Role != "workspace_admin" && u.Role != "member") {
		return nil, "", ErrDisabled
	}
	u.Disabled = false
	go s.db.Exec("UPDATE sessions SET last_seen_at=? WHERE token=?", nowISO(), token)
	return &u, actor, nil
}

func (s *Store) DeleteSession(token string) {
	s.db.Exec("DELETE FROM sessions WHERE token=?", token)
}

func (s *Store) PurgeSessions() {
	s.db.Exec("DELETE FROM sessions WHERE expires_at <= ?", nowISO())
}

func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// 沿用固定超级管理员；历史普通账号保持停用，新版分配的子管理员不受旧迁移影响。
func (s *Store) ensureSingleAdmin() error {
	migrated, err := s.queryInt("SELECT COUNT(*) FROM app_settings WHERE key='admin_id'")
	if err != nil {
		return err
	}
	if migrated == 0 {
		// SQLite 自带快照会包含 WAL；不删除旧账号或任何看板内容。
		if _, err := s.db.Exec("VACUUM INTO ?", s.path+".pre-single-admin-"+time.Now().UTC().Format("20060102T150405.000000000")+".db"); err != nil {
			return err
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRow("SELECT CAST(value AS INTEGER) FROM app_settings WHERE key='admin_id'").Scan(&id)
	if err == sql.ErrNoRows {
		err = tx.QueryRow(`SELECT id FROM users WHERE role='admin' AND disabled=0
    ORDER BY CASE WHEN username=? THEN 0 ELSE 1 END, id LIMIT 1`, envOr("KANBAN_ADMIN_USER", "admin")).Scan(&id)
		if err == sql.ErrNoRows {
			err = tx.QueryRow("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").Scan(&id)
		}
		if err != nil {
			return errors.New("没有可保留的管理员账号，请检查原数据库")
		}
		if _, err = tx.Exec("INSERT INTO app_settings(key,value) VALUES('admin_id',?)", id); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE id=?", id).Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return errors.New("原管理员账号不存在")
	}
	allowedRole := "workspace_admin"
	if migrated != 0 {
		allowedRole = "member"
	}
	if _, err = tx.Exec("UPDATE users SET disabled=1 WHERE id<>? AND role<>'workspace_admin' AND role<>?", id, allowedRole); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id<>? AND user_id NOT IN (SELECT id FROM users WHERE role='workspace_admin' OR role=?)", id, allowedRole); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE users SET role='admin',disabled=0 WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// Production initialization must never silently create a known default password.
// Existing installations keep their credentials; dev mode stays convenient locally.
func (s *Store) validateBootstrap(dev bool) error {
	n, err := s.queryInt("SELECT COUNT(*) FROM users")
	if err != nil {
		return err
	}
	if dev || n > 0 {
		return nil
	}
	password := os.Getenv("KANBAN_ADMIN_PASS")
	if len(password) < 12 || len(password) > 72 || strings.TrimSpace(password) == "" || password == "请替换为你的初始密码" {
		return errors.New("首次生产启动需设置 KANBAN_ADMIN_PASS（12–72 字节的非默认密码）")
	}
	return nil
}

// ChangeOwnPassword preserves this session and atomically revokes every other session.
func (s *Store) ChangeOwnPassword(id int64, password, token string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE users SET password_hash=?, must_change=0 WHERE id=?", hash, id); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=? AND token<>?", id, token); err != nil {
		return err
	}
	return tx.Commit()
}
