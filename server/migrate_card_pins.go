package main

func (s *Store) migrateCardPins() error {
	rows, err := s.db.Query("PRAGMA table_info(cards)")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, required, pk int
		var name, kind string
		var def any
		if err := rows.Scan(&cid, &name, &kind, &required, &def, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "pinned" {
			found = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil || found {
		return err
	}
	_, err = s.db.Exec("ALTER TABLE cards ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
	return err
}
