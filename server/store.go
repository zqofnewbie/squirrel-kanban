package main

import (
	"database/sql"
	_ "embed"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Store 封装全部数据库访问。SQLite 采用 WAL 且单写连接，
// 避免 "database is locked"；读取走同一连接池，规模足够。
type Store struct {
	db   *sql.DB
	path string
}

func openStore(path string) (*Store, error) {
	dsn := "file:" + filepathToURL(path) +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(ON)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("执行 schema 失败: %w", err)
	}
	s := &Store{db: db, path: path}
	if err := s.migrateCardPins(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrateColumnColors(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrateShareRecords(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrateWorkspaces(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func filepathToURL(p string) string {
	out := make([]rune, 0, len(p))
	for _, r := range p {
		if r == '\\' {
			out = append(out, '/')
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}

func (s *Store) Close() error { return s.db.Close() }

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

// ---------- 通用小工具 ----------

func (s *Store) queryInt(query string, args ...any) (int, error) {
	var n int
	err := s.db.QueryRow(query, args...).Scan(&n)
	return n, err
}

// nextPos 在目标容器内计算插入位置。beforeID 为 0 表示追加到末尾。
// 采用"取相邻两个位置的中间值"，使一次拖拽只 UPDATE 一行。
// firstPos 返回插到列首的位置（新卡片默认出现在最上面，而不是排到最下面）
func (s *Store) firstPos(table, scopeCol string, scopeID int64) (float64, error) {
	var first sql.NullFloat64
	err := s.db.QueryRow(
		"SELECT MIN(position) FROM "+table+" WHERE "+scopeCol+"=?", scopeID).Scan(&first)
	if err != nil {
		return 0, err
	}
	if first.Valid {
		return first.Float64 - 1024, nil
	}
	return 1024, nil
}

func (s *Store) nextPos(table, scopeCol string, scopeID, beforeID int64) (float64, error) {
	if beforeID == 0 {
		var last sql.NullFloat64
		err := s.db.QueryRow(
			"SELECT MAX(position) FROM "+table+" WHERE "+scopeCol+"=?", scopeID).Scan(&last)
		if err != nil {
			return 0, err
		}
		if last.Valid {
			return last.Float64 + 1024, nil
		}
		return 1024, nil
	}

	var target float64
	err := s.db.QueryRow("SELECT position FROM "+table+" WHERE id=?", beforeID).Scan(&target)
	if err != nil {
		return 0, err
	}
	var prev sql.NullFloat64
	err = s.db.QueryRow(
		"SELECT MAX(position) FROM "+table+" WHERE "+scopeCol+"=? AND position < ?",
		scopeID, target).Scan(&prev)
	if err != nil {
		return 0, err
	}
	if !prev.Valid {
		return target - 1024, nil
	}
	gap := target - prev.Float64
	if gap < 1e-4 {
		// 精度耗尽，重整该容器后再算一次
		if err := s.normalize(table, scopeCol, scopeID); err != nil {
			return 0, err
		}
		return s.nextPos(table, scopeCol, scopeID, beforeID)
	}
	return prev.Float64 + gap/2, nil
}

func (s *Store) normalize(table, scopeCol string, scopeID int64) error {
	rows, err := s.db.Query(
		"SELECT id FROM "+table+" WHERE "+scopeCol+"=? ORDER BY position, id", scopeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.Exec("UPDATE "+table+" SET position=? WHERE id=?", float64((i+1)*1024), id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) logActivity(boardID, cardID, userID int64, username, typ, detail string) {
	_, _ = s.db.Exec(
		`INSERT INTO activities(board_id, card_id, user_id, username, type, detail, created_at)
		 VALUES(?,?,?,?,?,?,?)`,
		boardID, nullInt(cardID), nullInt(userID), username, typ, detail, nowISO())
}

func nullInt(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
