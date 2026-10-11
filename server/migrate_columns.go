package main

import (
	"fmt"
	"strings"
	"time"
)

var columnColors = []string{"#58BFE8", "#B18AE7", "#5EC79A", "#F4777F", "#F5A253", "#EAC54F", "#ACC95C", "#4CC6BC", "#629FF0", "#7F8CEB", "#E68DC0", "#9AAFC6"}
var legacyColumnColors = []string{"#94A3B8", "#82C5EF", "#83CBA0"}

// 给历史列表保存当前配色；之后排序不再改变颜色。
func (s *Store) migrateColumnColors() error {
	rows, err := s.db.Query("PRAGMA table_info(board_columns)")
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
		if name == "color" {
			ready = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil || ready {
		return err
	}
	backup := s.path + ".pre-column-colors-" + time.Now().UTC().Format("20060102T150405.000000000") + ".db"
	if _, err = s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(backup, "'", "''") + "'"); err != nil {
		return fmt.Errorf("列表颜色迁移备份失败: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("ALTER TABLE board_columns ADD COLUMN color TEXT NOT NULL DEFAULT '#94A3B8'"); err != nil {
		return err
	}
	rows, err = tx.Query("SELECT id, board_id FROM board_columns ORDER BY board_id, position, id")
	if err != nil {
		return err
	}
	type entry struct {
		id    int64
		color string
	}
	columns := []entry{}
	var previous int64
	index := 0
	for rows.Next() {
		var id, boardID int64
		if err = rows.Scan(&id, &boardID); err != nil {
			rows.Close()
			return err
		}
		if boardID != previous {
			previous = boardID
			index = 0
		}
		columns = append(columns, entry{id, legacyColumnColors[index%3]})
		index++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, col := range columns {
		if _, err = tx.Exec("UPDATE board_columns SET color=? WHERE id=?", col.color, col.id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
