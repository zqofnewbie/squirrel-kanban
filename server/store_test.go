package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestColumnColorsMigratePersistAndFollowSorting(t *testing.T) {
	s := testStore(t)
	b, err := s.CreateBoard("原看板", "保留内容", "")
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := s.GetBoardDetail(b.ID)
	first, second := detail.Columns[0].ID, detail.Columns[1].ID
	card, err := s.CreateCard(first, "原有任务", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec("ALTER TABLE board_columns DROP COLUMN color"); err != nil {
		t.Fatal(err)
	}
	if err = s.migrateColumnColors(); err != nil {
		t.Fatal(err)
	}
	detail, err = s.GetBoardDetail(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Description != "保留内容" || detail.Columns[0].Cards[0].ID != card.ID {
		t.Fatal("迁移改变了现有内容")
	}
	for i, col := range detail.Columns {
		if col.Color != []string{"#94A3B8", "#82C5EF", "#83CBA0"}[i] {
			t.Fatal("未保留旧列表配色")
		}
	}
	custom := "#C486D7"
	if err = s.UpdateColumn(first, "准备交付", nil, &custom); err != nil {
		t.Fatal(err)
	}
	if err = s.MoveColumn(first, 0); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateColumn(first, "交付", nil, nil); err != nil {
		t.Fatal(err)
	}
	if err = s.migrateColumnColors(); err != nil {
		t.Fatal(err)
	}
	fresh, err := s.GetColumn(first)
	if err != nil || fresh.Color != custom || fresh.Name != "交付" {
		t.Fatal("颜色被重命名、排序或重复迁移覆盖")
	}
	detail, _ = s.GetBoardDetail(b.ID)
	if detail.Columns[0].ID != second || detail.Columns[len(detail.Columns)-1].Color != custom {
		t.Fatal("颜色没有随列表排序")
	}
	backups, _ := filepath.Glob(s.path + ".pre-column-colors-*.db")
	if len(backups) != 1 {
		t.Fatal("迁移应创建一次备份")
	}
	if err = s.db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := openStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	fresh, err = reopened.GetColumn(first)
	if err != nil || fresh.Color != custom {
		t.Fatal("重启后颜色丢失")
	}
}

func TestColumnColorValidationAndPartialUpdates(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("admin", "管理员", "test-pass", "admin", false); err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(1, "test")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	b, _ := s.CreateBoard("颜色设置", "", "")
	detail, _ := s.GetBoardDetail(b.ID)
	id := detail.Columns[0].ID
	path := "/api/columns/" + strconv.FormatInt(id, 10)
	handler := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	for _, invalid := range []string{"red", "#123", "#12ZZ45", ""} {
		mustStatus(t, apiCall(t, handler, "PATCH", path, `{"color":"`+invalid+`","name":"不应保存"}`, cookie), http.StatusBadRequest)
	}
	mustStatus(t, apiCall(t, handler, "PATCH", path, `{"color":"#ab12cd"}`, cookie), http.StatusOK)
	fresh, _ := s.GetColumn(id)
	if fresh.Color != "#AB12CD" || fresh.Name != "待办" {
		t.Fatal("只改颜色时覆盖了列表名称")
	}
	mustStatus(t, apiCall(t, handler, "PATCH", path, `{"name":"准备"}`, cookie), http.StatusOK)
	board := apiCall(t, handler, "GET", "/api/boards/"+strconv.FormatInt(b.ID, 10), "", cookie)
	mustStatus(t, board, http.StatusOK)
	if !strings.Contains(board.Body.String(), `"color":"#AB12CD"`) {
		t.Fatal("保存的颜色未返回到看板")
	}
	mustStatus(t, apiCall(t, handler, "PATCH", "/api/columns/999999", `{"color":"#AB12CD"}`, cookie), http.StatusNotFound)
}

func TestCardMoveAndArchivePersist(t *testing.T) {
	s := testStore(t)
	b, err := s.CreateBoard("中文看板", "", "")
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetBoardDetail(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	first, second := detail.Columns[0].ID, detail.Columns[1].ID
	a, err := s.CreateCard(first, "第一件事", 0)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.CreateCard(first, "第二件事", 0)
	if err != nil {
		t.Fatal(err)
	}
	detail, _ = s.GetBoardDetail(b.ID)
	if detail.Columns[0].Cards[len(detail.Columns[0].Cards)-1].ID != c.ID {
		t.Fatal("新卡片应追加在列尾")
	}
	if _, err = s.MoveCard(c.ID, second, 0); err != nil {
		t.Fatal(err)
	}
	if _, err = s.MoveCard(a.ID, second, c.ID); err != nil {
		t.Fatal(err)
	}
	detail, _ = s.GetBoardDetail(b.ID)
	if len(detail.Columns[0].Cards) != 0 || len(detail.Columns[1].Cards) != 2 || detail.Columns[1].Cards[0].ID != a.ID {
		t.Fatal("跨列和列内排序应持久化")
	}
	archived := true
	if _, err = s.UpdateCard(a.ID, CardPatch{Archived: &archived}); err != nil {
		t.Fatal(err)
	}
	detail, _ = s.GetBoardDetail(b.ID)
	if len(detail.Columns[1].Cards) != 1 {
		t.Fatal("归档卡片不应出现在看板")
	}
	archived = false
	if _, err = s.UpdateCard(a.ID, CardPatch{Archived: &archived}); err != nil {
		t.Fatal(err)
	}
	detail, _ = s.GetBoardDetail(b.ID)
	if len(detail.Columns[1].Cards) != 2 {
		t.Fatal("恢复卡片应保留位置")
	}
}

func TestAttachmentRequiresSessionAndDownloadsSafely(t *testing.T) {
	s := testStore(t)
	data := t.TempDir()
	if err := os.MkdirAll(filesDir(data), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesDir(data), "test.html"), []byte("<script>alert(1)</script>"), 0600); err != nil {
		t.Fatal(err)
	}
	srv := &Server{store: s, hub: NewHub(), dataDir: data}
	routes := srv.routes()
	unauth := httptest.NewRecorder()
	routes.ServeHTTP(unauth, httptest.NewRequest("GET", "/files/test.html", nil))
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("匿名附件请求返回 %d", unauth.Code)
	}
	if err := s.CreateUser("tester", "测试成员", "test-password", "admin", false); err != nil {
		t.Fatal(err)
	}
	user, err := s.Authenticate("tester", "test-password")
	if err != nil {
		t.Fatal(err)
	}
	session, err := s.CreateSession(user.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/files/test.html", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: session.Token})
	response := httptest.NewRecorder()
	routes.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("登录后的附件请求返回 %d", response.Code)
	}
	if response.Header().Get("Content-Disposition") != "attachment" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("附件必须下载，不能在同源页面执行")
	}
}

func TestDeletingScopesRemovesAttachmentFiles(t *testing.T) {
	for _, scope := range []string{"cards", "columns", "boards"} {
		t.Run(scope, func(t *testing.T) {
			s := testStore(t)
			data := t.TempDir()
			if err := os.MkdirAll(filesDir(data), 0755); err != nil {
				t.Fatal(err)
			}
			if err := s.CreateUser("tester", "测试成员", "test-password", "admin", false); err != nil {
				t.Fatal(err)
			}
			user, err := s.Authenticate("tester", "test-password")
			if err != nil {
				t.Fatal(err)
			}
			session, err := s.CreateSession(user.ID, "test")
			if err != nil {
				t.Fatal(err)
			}
			board, err := s.CreateBoard("测试看板", "", "")
			if err != nil {
				t.Fatal(err)
			}
			detail, err := s.GetBoardDetail(board.ID)
			if err != nil {
				t.Fatal(err)
			}
			col := detail.Columns[0].ID
			card, err := s.CreateCard(col, "测试任务", user.ID)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.CreateAttachment(card.ID, "test.txt", "/files/test.txt", 4); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(filesDir(data), "test.txt")
			if err := os.WriteFile(file, []byte("test"), 0600); err != nil {
				t.Fatal(err)
			}
			id := card.ID
			if scope == "columns" {
				id = col
			}
			if scope == "boards" {
				id = board.ID
			}
			req := httptest.NewRequest("DELETE", "/api/"+scope+"/"+strconv.FormatInt(id, 10), nil)
			req.AddCookie(&http.Cookie{Name: cookieName, Value: session.Token})
			response := httptest.NewRecorder()
			srv := &Server{store: s, hub: NewHub(), dataDir: data}
			srv.routes().ServeHTTP(response, req)
			if response.Code != http.StatusOK && response.Code != http.StatusNoContent {
				t.Fatalf("删除失败: %d %s", response.Code, response.Body.String())
			}
			if _, err := os.Stat(file); !os.IsNotExist(err) {
				t.Fatalf("附件实体仍存在: %v", err)
			}
		})
	}
}

func TestCardDisplayMetadataMatchesDetailAndSummary(t *testing.T) {
	s := testStore(t)
	b, _ := s.CreateBoard("展示验证", "", "")
	d, _ := s.GetBoardDetail(b.ID)
	c, _ := s.CreateCard(d.Columns[0].ID, "含设置的卡片", 1)
	desc, due, cover := "描述需要显示", "2027-02-01", "#E1F5EE"
	if _, err := s.UpdateCard(c.ID, CardPatch{Description: &desc, DueDate: &due, Cover: &cover}); err != nil {
		t.Fatal(err)
	}
	l, _ := s.CreateLabel(b.ID, "优先级", "#2563EB")
	s.ToggleCardLabel(c.ID, l.ID, true)
	cl, _ := s.CreateChecklist(c.ID, "交付清单")
	it, _ := s.CreateChecklistItem(cl.ID, "验证功能")
	s.UpdateChecklistItem(it.ID, "", boolPtr(true))
	s.CreateAttachment(c.ID, "文档.txt", "/files/qa.txt", 4)
	s.db.Exec("INSERT INTO card_comments(card_id,author,content,created_at) VALUES(?,?,?,?)", c.ID, "管理员", "已确认", nowISO())
	assert := func(card *Card) {
		t.Helper()
		if card == nil || card.Description != desc || card.DueDate != due || card.Cover != cover || len(card.Labels) != 1 || card.ChecklistTotal != 1 || card.ChecklistDone != 1 || card.AttachmentCount != 1 || card.CommentCount != 1 {
			t.Fatalf("卡面信息不一致: %+v", card)
		}
	}
	detail, err := s.GetCard(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	assert(detail)
	summary, err := s.CardSummary(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	assert(summary)
	board, err := s.GetBoardDetail(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	assert(&board.Columns[0].Cards[0])
	s.DeleteChecklistItem(it.ID)
	s.DeleteLabel(l.ID)
	summary, err = s.CardSummary(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.ChecklistTotal != 0 || summary.ChecklistDone != 0 || len(summary.Labels) != 0 {
		t.Fatal("删除设置后卡片摘要未更新")
	}
}
