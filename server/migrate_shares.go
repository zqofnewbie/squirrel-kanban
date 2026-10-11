package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

func shortShareKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// 原记录、旧密钥和访客会话保留；移除每个看板只能有一条分享的约束。
func (s *Store) migrateShareRecords() error {
	rows, err := s.db.Query("PRAGMA table_info(board_shares)")
	if err != nil {
		return err
	}
	ready := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var def any
		if err = rows.Scan(&cid, &name, &kind, &notnull, &def, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "short_key" {
			ready = true
		}
	}
	rows.Close()
	if ready {
		_, err = s.db.Exec("CREATE INDEX IF NOT EXISTS idx_shares_board ON board_shares(board_id)")
		return err
	}
	backup := s.path + ".pre-share-records-" + time.Now().UTC().Format("20060102T150405.000000000") + ".db"
	if _, err = s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(backup, "'", "''") + "'"); err != nil {
		return fmt.Errorf("分享迁移备份失败: %w", err)
	}
	if _, err = s.db.Exec("PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer s.db.Exec("PRAGMA foreign_keys=ON")
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE board_shares_next (
 id TEXT PRIMARY KEY, board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 access_key TEXT NOT NULL, short_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '{}')`); err != nil {
		return err
	}
	rows, err = tx.Query(`SELECT sh.id,sh.board_id,sh.access_key,sh.enabled,sh.expires_at,sh.permissions,b.name
 FROM board_shares sh JOIN boards b ON b.id=sh.board_id`)
	if err != nil {
		return err
	}
	type oldShare struct {
		id                        string
		board                     int64
		key                       string
		enabled                   int
		expiry, permissions, name string
	}
	old := []oldShare{}
	for rows.Next() {
		var sh oldShare
		if err = rows.Scan(&sh.id, &sh.board, &sh.key, &sh.enabled, &sh.expiry, &sh.permissions, &sh.name); err != nil {
			rows.Close()
			return err
		}
		old = append(old, sh)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, sh := range old {
		key, e := shortShareKey()
		if e != nil {
			return e
		}
		if _, err = tx.Exec("INSERT INTO board_shares_next VALUES(?,?,?,?,?,?,?,?,?)", sh.id, sh.board, sh.key, key, sh.name+" · 分享", nowISO(), sh.enabled, sh.expiry, sh.permissions); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("DROP TABLE board_shares"); err != nil {
		return err
	}
	if _, err = tx.Exec("ALTER TABLE board_shares_next RENAME TO board_shares"); err != nil {
		return err
	}
	if _, err = tx.Exec("CREATE INDEX idx_shares_board ON board_shares(board_id)"); err != nil {
		return err
	}
	return tx.Commit()
}
