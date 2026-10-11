package main

import "testing"

func TestCardPinPersistsAndOrders(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("root", "root", "test-password", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureWelcomeBoard(1, "en"); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	b, _ := s.GetBoardDetail(boards[0].ID)
	col := b.Columns[0]
	id := col.Cards[len(col.Cards)-1].ID
	on := true
	if _, err := s.UpdateCard(id, CardPatch{Pinned: &on}); err != nil {
		t.Fatal(err)
	}
	c, err := s.GetCard(id)
	if err != nil || !c.Pinned {
		t.Fatalf("pin not saved: %v", err)
	}
	b, err = s.GetBoardDetail(b.ID)
	if err != nil || b.Columns[0].Cards[0].ID != id {
		t.Fatalf("pin not first: %v", err)
	}
	fresh, err := s.CreateCard(col.ID, "New unpinned card", 1)
	if err != nil {
		t.Fatal(err)
	}
	b, _ = s.GetBoardDetail(b.ID)
	if b.Columns[0].Cards[0].ID != id {
		t.Fatal("new card displaced pin")
	}
	if _, err = s.MoveCard(id, b.Columns[1].ID, 0); err != nil {
		t.Fatal(err)
	}
	b, _ = s.GetBoardDetail(b.ID)
	if b.Columns[1].Cards[0].ID != id {
		t.Fatal("move lost pin priority")
	}
	on = false
	c, err = s.UpdateCard(id, CardPatch{Pinned: &on})
	if err != nil || c.Pinned {
		t.Fatal("unpin failed")
	}
	if err := s.migrateCardPins(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCard(fresh.ID); err != nil {
		t.Fatal("migration damaged data")
	}
}
