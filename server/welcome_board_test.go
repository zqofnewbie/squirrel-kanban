package main

import "testing"

func TestWelcomeBoardOnlyOnceAndLocalized(t *testing.T) {
	for _, language := range []string{"zh-CN", "en-US"} {
		t.Run(language, func(t *testing.T) {
			s := testStore(t)
			if err := s.CreateUser("root", "root", "test-password", "admin", false); err != nil {
				t.Fatal(err)
			}
			if err := s.ensureWelcomeBoard(1, language); err != nil {
				t.Fatal(err)
			}
			boards, _ := s.ListBoards()
			if len(boards) != 1 {
				t.Fatal("expected one template")
			}
			board, _ := s.GetBoardDetail(boards[0].ID)
			if len(board.Columns) != 3 {
				t.Fatal("missing columns")
			}
			count := 0
			for _, col := range board.Columns {
				count += len(col.Cards)
			}
			if count != 5 {
				t.Fatal("missing sample cards")
			}
			card, err := s.GetCard(board.Columns[0].Cards[0].ID)
			if err != nil || len(card.Checklists) != 1 || len(card.Checklists[0].Items) != 3 || len(card.Labels) != 1 {
				t.Fatalf("incomplete sample: %+v %v", card, err)
			}
			if language == "en-US" && board.Columns[0].Name != "To do" {
				t.Fatal("template did not follow language")
			}
			if err := s.ensureWelcomeBoard(1, language); err != nil {
				t.Fatal(err)
			}
			boards, _ = s.ListBoards()
			if len(boards) != 1 {
				t.Fatal("duplicate template")
			}
			if err := s.DeleteBoard(board.ID); err != nil {
				t.Fatal(err)
			}
			if err := s.ensureWelcomeBoard(1, language); err != nil {
				t.Fatal(err)
			}
			boards, _ = s.ListBoards()
			if len(boards) != 0 {
				t.Fatal("deleted template came back")
			}
		})
	}
}
func TestWelcomeBoardPreservesExistingContent(t *testing.T) {
	s := testStore(t)
	s.CreateUser("root", "root", "test-password", "admin", false)
	b, err := s.CreateBoard("Existing project", "Keep this", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ensureWelcomeBoard(1, "en"); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	existing, err := s.GetBoard(b.ID)
	if len(boards) != 2 || err != nil || existing.Name != "Existing project" || existing.Description != "Keep this" {
		t.Fatal("changed existing boards")
	}
}
