package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func apiCall(t *testing.T, handler http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
func mustStatus(t *testing.T, rec *httptest.ResponseRecorder, code int) {
	t.Helper()
	if rec.Code != code {
		t.Fatalf("want %d, got %d: %s", code, rec.Code, rec.Body.String())
	}
}
func TestSingleAdminMigrationPreservesData(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("original", "原管理员", "original-pass", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser("second", "第二管理员", "second-pass", "admin", false); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser("member", "旧成员", "member-pass", "member", false); err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateBoard("保留的中文看板", "内容不能丢失", "")
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := s.GetBoardDetail(b.ID)
	c, err := s.CreateCard(detail.Columns[0].ID, "原有卡片", 3)
	if err != nil {
		t.Fatal(err)
	}
	list, _ := s.CreateChecklist(c.ID, "原清单")
	s.CreateChecklistItem(list.ID, "原清单项")
	s.CreateAttachment(c.ID, "原附件", "/files/original.txt", 42)
	s.logActivity(b.ID, c.ID, 3, "旧成员", "created", "历史记录")
	old, err := s.CreateSession(2, "old")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("KANBAN_ADMIN_USER", "original")
	if err = s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	n, _ := s.queryInt("SELECT COUNT(*) FROM users WHERE disabled=0")
	if n != 1 {
		t.Fatal("只能有一个有效账号")
	}
	for _, login := range []struct{ name, pass string }{{"second", "second-pass"}, {"member", "member-pass"}} {
		if _, err = s.Authenticate(login.name, login.pass); err == nil {
			t.Fatal("旧账号仍能登录")
		}
	}
	if _, _, err = s.SessionUser(old.Token); err == nil {
		t.Fatal("旧会话未撤销")
	}
	admin, err := s.Authenticate("original", "original-pass")
	if err != nil || admin.ID != 1 {
		t.Fatal("管理员账号或密码发生变化")
	}
	got, err := s.GetCard(c.ID)
	if err != nil || got.Title != c.Title || got.CreatedBy != 3 || len(got.Checklists) != 1 || len(got.Checklists[0].Items) != 1 || len(got.Attachments) != 1 {
		t.Fatal("卡片数据未保留")
	}
	acts, _ := s.ListActivities(c.ID, 30)
	if len(acts) != 1 || acts[0].Username != "旧成员" {
		t.Fatal("历史活动未保留")
	}
	backups, _ := filepath.Glob(s.path + ".pre-single-admin-*.db")
	if len(backups) != 1 {
		t.Fatal("迁移前快照缺失")
	}
	snapshot, err := openStore(backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	n, _ = snapshot.queryInt("SELECT COUNT(*) FROM users WHERE disabled=0")
	if n != 3 {
		t.Fatal("快照不是迁移前的数据")
	}
	t.Setenv("KANBAN_ADMIN_USER", "second")
	if err = s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	n, _ = s.queryInt("SELECT COUNT(*) FROM users WHERE id=1 AND disabled=0")
	if n != 1 {
		t.Fatal("重启切换了管理员")
	}
	backups, _ = filepath.Glob(s.path + ".pre-single-admin-*.db")
	if len(backups) != 1 {
		t.Fatal("重复迁移生成了多余备份")
	}
}
func TestShareAccessPermissionsScopeAndRevocation(t *testing.T) {
	t.Setenv("KANBAN_ADMIN_USER", "admin")
	t.Setenv("KANBAN_ADMIN_PASS", "admin")
	s := testStore(t)
	if err := s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	admin, _ := s.Authenticate("admin", "admin")
	session, _ := s.CreateSession(admin.ID, "test")
	ac := &http.Cookie{Name: cookieName, Value: session.Token}
	data := t.TempDir()
	os.MkdirAll(filesDir(data), 0755)
	os.WriteFile(filepath.Join(filesDir(data), "a.txt"), []byte("hello"), 0600)
	srv := &Server{store: s, hub: NewHub(), dataDir: data}
	handler := srv.routes()
	if err := s.createStarterBoard(1); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	b, _ := s.GetBoardDetail(boards[0].ID)
	c := b.Columns[0].Cards[0]
	cl, _ := s.CreateChecklist(c.ID, "清单")
	it, _ := s.CreateChecklistItem(cl.ID, "一项")
	a, _ := s.CreateAttachment(c.ID, "附件.txt", "/files/a.txt", 5)
	private, _ := s.CreateBoard("秘密看板", "", "")
	pd, _ := s.GetBoardDetail(private.ID)
	pc, _ := s.CreateCard(pd.Columns[0].ID, "秘密任务", admin.ID)
	pcl, _ := s.CreateChecklist(pc.ID, "秘密清单")
	pit, _ := s.CreateChecklistItem(pcl.ID, "秘密项")
	pa, _ := s.CreateAttachment(pc.ID, "秘密附件", "/files/a.txt", 5)
	settings := ""
	save := func(payload string) BoardShare {
		t.Helper()
		var value map[string]any
		if err := json.Unmarshal([]byte(payload), &value); err != nil {
			t.Fatal(err)
		}
		value["name"] = "测试分享"
		method, path, want := "PATCH", settings, 200
		if settings == "" {
			method, path, want = "POST", "/api/shares", 201
			value["board_id"] = b.ID
		}
		body, _ := json.Marshal(value)
		rec := apiCall(t, handler, method, path, string(body), ac)
		mustStatus(t, rec, want)
		var sh BoardShare
		if err := json.Unmarshal(rec.Body.Bytes(), &sh); err != nil {
			t.Fatal(err)
		}
		settings = "/api/shares/" + sh.ID
		return sh
	}
	sh := save(`{"enabled":true,"expires_at":"","permissions":{}}`)
	if len(sh.Key) != 64 || len(sh.ID) != 32 {
		t.Fatal("密钥随机长度不足")
	}
	base := "/api/shared/" + sh.ID
	enter := func(key string) *http.Cookie {
		t.Helper()
		rec := apiCall(t, handler, "POST", base+"/session", fmt.Sprintf(`{"key":%q}`, key), nil)
		mustStatus(t, rec, 200)
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].Path != base+"/" {
			t.Fatal("访客 cookie 不隔离")
		}
		return cookies[0]
	}
	mustStatus(t, apiCall(t, handler, "GET", base+"/board", "", nil), 403)
	mustStatus(t, apiCall(t, handler, "POST", base+"/session", `{"key":"wrong"}`, nil), 403)
	gc := enter(sh.Key)
	previewPath := fmt.Sprintf("%s/attachments/%d?preview=1", base, a.ID)
	mustStatus(t, apiCall(t, handler, "GET", previewPath, "", gc), 403)
	read := apiCall(t, handler, "GET", base+"/board", "", gc)
	mustStatus(t, read, 200)
	if strings.Contains(read.Body.String(), sh.Key) || strings.Contains(read.Body.String(), "秘密") {
		t.Fatal("分享泄露其他看板或密钥")
	}
	cardPath := fmt.Sprintf("%s/cards/%d", base, c.ID)
	read = apiCall(t, handler, "GET", cardPath, "", gc)
	mustStatus(t, read, 200)
	if strings.Contains(read.Body.String(), "/files/") {
		t.Fatal("只读暴露附件地址")
	}
	denied := []struct{ method, path, body string }{
		{"PATCH", cardPath, `{"title":"不允许修改"}`},
		{"POST", cardPath + "/move", fmt.Sprintf(`{"column_id":%d}`, b.Columns[1].ID)},
		{"POST", cardPath + "/comments", `{"content":"不允许评论"}`},
		{"POST", fmt.Sprintf("%s/columns/%d/cards", base, b.Columns[0].ID), `{"title":"不允许新建"}`},
		{"PATCH", fmt.Sprintf("%s/items/%d", base, it.ID), `{"done":true}`},
		{"GET", fmt.Sprintf("%s/attachments/%d", base, a.ID), ""},
		{"PATCH", cardPath, `{"pinned":true}`},
		{"PATCH", cardPath, `{"cover":"#629FF0"}`},
	}
	for _, d := range denied {
		mustStatus(t, apiCall(t, handler, d.method, d.path, d.body, gc), 403)
	}

	// 每个开关独立生效，不能因为开启评论而获得卡片编辑或其他权限。
	for index, key := range []string{"edit", "move", "comment", "create", "checklist", "download", "pin", "cover"} {
		save(fmt.Sprintf(`{"enabled":true,"expires_at":"","permissions":{%q:true}}`, key))
		for j, d := range denied {
			rec := apiCall(t, handler, d.method, d.path, d.body, gc)
			if j == index {
				want := 200
				if key == "create" {
					want = 201
				}
				mustStatus(t, rec, want)
			} else {
				mustStatus(t, rec, 403)
			}
		}
	}
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{}`, gc), 400)
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{"cover":"invalid"}`, gc), 400)
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{"cover":"#abcdef","title":"不得越权"}`, gc), 403)
	save(`{"enabled":true,"expires_at":"","permissions":{}}`)
	// 不同分享链接的 Cookie 不能互换。
	otherRec := apiCall(t, handler, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"另一看板","enabled":true,"expires_at":"","permissions":{}}`, private.ID), ac)
	mustStatus(t, otherRec, 201)
	var otherShare BoardShare
	json.Unmarshal(otherRec.Body.Bytes(), &otherShare)
	mustStatus(t, apiCall(t, handler, "GET", "/api/shared/"+otherShare.ID+"/board", "", gc), 403)

	// 访客会话永远不能访问管理员 API，包括附件和全局事件流。
	for _, path := range []string{"/api/boards", "/api/users", "/api/events", "/files/a.txt", settings} {
		mustStatus(t, apiCall(t, handler, "GET", path, "", gc), 401)
	}
	mustStatus(t, apiCall(t, handler, "POST", "/api/users", `{"username":"intruder"}`, gc), 401)
	sh = save(`{"enabled":true,"expires_at":"","permissions":{"download":true,"comment":true,"checklist":true,"move":true,"edit":true,"create":true}}`)
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{"title":"已编辑","description":"共享描述","due_date":"2027-01-01"}`, gc), 200)
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{"archived":true}`, gc), 400)
	mustStatus(t, apiCall(t, handler, "POST", cardPath+"/comments", `{"content":"意见","author":"测试"}`, gc), 200)
	mustStatus(t, apiCall(t, handler, "PATCH", fmt.Sprintf("%s/items/%d", base, it.ID), `{"done":true}`, gc), 200)
	mustStatus(t, apiCall(t, handler, "PATCH", fmt.Sprintf("%s/items/%d", base, it.ID), `{"done":false,"text":"恶意改名"}`, gc), 400)
	mustStatus(t, apiCall(t, handler, "POST", fmt.Sprintf("%s/columns/%d/cards", base, b.Columns[0].ID), `{"title":"访客新增"}`, gc), 201)
	download := apiCall(t, handler, "GET", fmt.Sprintf("%s/attachments/%d", base, a.ID), "", gc)
	mustStatus(t, download, 200)
	if download.Body.String() != "hello" || !strings.HasPrefix(download.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("附件下载失败")
	}
	preview := apiCall(t, handler, "GET", previewPath, "", gc)
	mustStatus(t, preview, 200)
	if preview.Body.String() != "hello" || !strings.HasPrefix(preview.Header().Get("Content-Disposition"), "inline") || preview.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("分享附件预览失败")
	}
	mustStatus(t, apiCall(t, handler, "GET", fmt.Sprintf("%s/attachments/%d?preview=1", base, pa.ID), "", gc), 404)
	mustStatus(t, apiCall(t, handler, "GET", fmt.Sprintf("/api/attachments/%d/preview", a.ID), "", gc), 401)
	// 即使全部协作开启，也不能跨看板或触达归档卡片。
	for _, path := range []string{fmt.Sprintf("%s/cards/%d", base, pc.ID), fmt.Sprintf("%s/cards/%d/comments", base, pc.ID), fmt.Sprintf("%s/attachments/%d", base, pa.ID)} {
		mustStatus(t, apiCall(t, handler, "GET", path, "", gc), 404)
	}
	mustStatus(t, apiCall(t, handler, "PATCH", fmt.Sprintf("%s/items/%d", base, pit.ID), `{"done":true}`, gc), 404)
	mustStatus(t, apiCall(t, handler, "PATCH", fmt.Sprintf("%s/cards/%d", base, pc.ID), `{"title":"恶意"}`, gc), 404)
	mustStatus(t, apiCall(t, handler, "POST", cardPath+"/move", fmt.Sprintf(`{"column_id":%d}`, pd.Columns[0].ID), gc), 403)
	mustStatus(t, apiCall(t, handler, "POST", cardPath+"/move", fmt.Sprintf(`{"column_id":%d,"before_id":%d}`, b.Columns[1].ID, pc.ID), gc), 400)
	mustStatus(t, apiCall(t, handler, "POST", fmt.Sprintf("%s/columns/%d/cards", base, pd.Columns[0].ID), `{"title":"恶意"}`, gc), 404)
	mustStatus(t, apiCall(t, handler, "POST", cardPath+"/move", fmt.Sprintf(`{"column_id":%d}`, b.Columns[1].ID), gc), 200)
	s.UpdateCard(c.ID, CardPatch{Archived: boolPtr(true)})
	mustStatus(t, apiCall(t, handler, "GET", cardPath, "", gc), 404)
	s.UpdateCard(c.ID, CardPatch{Archived: boolPtr(false)})
	mustStatus(t, apiCall(t, handler, "GET", previewPath, "", gc), 200)
	// 权限关闭对已创建的会话生效。
	save(`{"enabled":true,"expires_at":"","permissions":{}}`)
	mustStatus(t, apiCall(t, handler, "PATCH", cardPath, `{"title":"已撤销权限"}`, gc), 403)
	mustStatus(t, apiCall(t, handler, "GET", previewPath, "", gc), 403)
	// 修改配置不会改变链接，也不会撤销仍有效的会话。
	rotated := save(`{"enabled":true,"expires_at":"","permissions":{}}`)
	if rotated.Key != sh.Key || rotated.ShortKey != sh.ShortKey {
		t.Fatal("编辑设置改变了固定链接")
	}
	mustStatus(t, apiCall(t, handler, "GET", base+"/board", "", gc), 200)
	save(`{"enabled":false,"expires_at":"","permissions":{}}`)
	mustStatus(t, apiCall(t, handler, "GET", base+"/board", "", gc), 403)
	save(`{"enabled":true,"expires_at":"","permissions":{}}`)
	mustStatus(t, apiCall(t, handler, "GET", base+"/board", "", gc), 403)
	gc = enter(rotated.Key)
	save(fmt.Sprintf(`{"enabled":true,"expires_at":%q,"permissions":{}}`, time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)))
	mustStatus(t, apiCall(t, handler, "GET", base+"/board", "", gc), 403)
	mustStatus(t, apiCall(t, handler, "POST", base+"/session", fmt.Sprintf(`{"key":%q}`, rotated.Key), nil), 403)
}
func TestShareRejectsCrossSiteRequests(t *testing.T) {
	srv := &Server{store: testStore(t), hub: NewHub(), dataDir: t.TempDir()}
	req := httptest.NewRequest("POST", "/api/shared/unknown/session", strings.NewReader(`{"key":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	mustStatus(t, rec, 403)
}

func TestShareManagementPreservesBoardAndRevokesVisitors(t *testing.T) {
	t.Setenv("KANBAN_ADMIN_USER", "admin")
	t.Setenv("KANBAN_ADMIN_PASS", "admin")
	s := testStore(t)
	if err := s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	admin, _ := s.Authenticate("admin", "admin")
	session, _ := s.CreateSession(admin.ID, "test")
	ac := &http.Cookie{Name: cookieName, Value: session.Token}
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	if err := s.createStarterBoard(1); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	before, _ := s.GetBoardDetail(boards[0].ID)
	rec := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"管理测试","enabled":true,"expires_at":"","permissions":{"comment":true}}`, before.ID), ac)
	mustStatus(t, rec, 201)
	var sh BoardShare
	if err := json.Unmarshal(rec.Body.Bytes(), &sh); err != nil {
		t.Fatal(err)
	}
	settings := "/api/shares/" + sh.ID
	base := "/api/shared/" + sh.ID
	rec = apiCall(t, h, "POST", base+"/session", fmt.Sprintf(`{"key":%q}`, sh.Key), nil)
	mustStatus(t, rec, 200)
	gc := rec.Result().Cookies()[0]
	mustStatus(t, apiCall(t, h, "GET", "/api/shares", "", nil), 401)
	mustStatus(t, apiCall(t, h, "GET", "/api/shares", "", gc), 401)
	rec = apiCall(t, h, "GET", "/api/shares", "", ac)
	mustStatus(t, rec, 200)
	var entries []struct {
		BoardShare
		BoardName string `json:"board_name"`
		Active    bool   `json:"active"`
		Sessions  int    `json:"sessions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].BoardName != before.Name || !entries[0].Active || entries[0].Sessions != 1 || !entries[0].Permissions.Comment {
		t.Fatalf("分享管理信息不完整: %+v", entries)
	}
	if strings.Contains(rec.Body.String(), sh.Key) || entries[0].Key != "" {
		t.Fatal("列表不应暴露分享密钥")
	}
	mustStatus(t, apiCall(t, h, "DELETE", settings, "", gc), 401)
	mustStatus(t, apiCall(t, h, "DELETE", settings, "", ac), 200)
	mustStatus(t, apiCall(t, h, "GET", base+"/board", "", gc), 403)
	mustStatus(t, apiCall(t, h, "POST", base+"/session", fmt.Sprintf(`{"key":%q}`, sh.Key), nil), 403)
	if n, _ := s.queryInt("SELECT COUNT(*) FROM share_sessions"); n != 0 {
		t.Fatal("分享移除后会话未清理")
	}
	rec = apiCall(t, h, "GET", "/api/shares", "", ac)
	if rec.Body.String() != "[]\n" {
		t.Fatalf("移除后列表不是空数组: %s", rec.Body.String())
	}
	after, err := s.GetBoardDetail(before.ID)
	if err != nil || after.Name != before.Name || len(after.Columns) != len(before.Columns) || len(after.Columns[0].Cards) != len(before.Columns[0].Cards) {
		t.Fatal("移除链接改变了看板内容")
	}
	// 旧服务或错误接口必须返回 JSON 错误，不能让前端把 HTML 当成列表。
	rec = apiCall(t, h, "GET", "/api/unknown", "", ac)
	mustStatus(t, rec, 404)
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatal("未知接口没有返回 JSON")
	}
}

func TestFixedSharesAreIndependentAndShort(t *testing.T) {
	t.Setenv("KANBAN_ADMIN_USER", "admin")
	t.Setenv("KANBAN_ADMIN_PASS", "admin")
	s := testStore(t)
	if err := s.ensureSeed(); err != nil {
		t.Fatal(err)
	}
	admin, _ := s.Authenticate("admin", "admin")
	ss, _ := s.CreateSession(admin.ID, "test")
	ac := &http.Cookie{Name: cookieName, Value: ss.Token}
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	if err := s.createStarterBoard(1); err != nil {
		t.Fatal(err)
	}
	boards, _ := s.ListBoards()
	bid := boards[0].ID
	create := func(name string, permissions string) BoardShare {
		rec := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"name":%q,"board_id":%d,"enabled":true,"permissions":%s}`, name, bid, permissions), ac)
		mustStatus(t, rec, 201)
		var sh BoardShare
		if err := json.Unmarshal(rec.Body.Bytes(), &sh); err != nil {
			t.Fatal(err)
		}
		return sh
	}
	a := create("客户只读", `{}`)
	b := create("评审协作", `{"comment":true}`)
	if len(a.ShortKey) != 22 || a.ShortKey == b.ShortKey || a.ID == b.ID {
		t.Fatal("分享码长度或独立性错误")
	}
	enter := func(sh BoardShare) *http.Cookie {
		rec := apiCall(t, h, "POST", "/api/shared/"+sh.ShortKey+"/session", `{}`, nil)
		mustStatus(t, rec, 200)
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Path != "/api/shared/"+sh.ShortKey+"/" || !cookies[0].HttpOnly {
			t.Fatal("短链接 Cookie 范围错误")
		}
		return cookies[0]
	}
	ag, bg := enter(a), enter(b)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+a.ShortKey+"/board", "", ag), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+b.ShortKey+"/board", "", ag), 403)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+a.ShortKey+"/board", "", ac), 403)
	rec := apiCall(t, h, "PATCH", "/api/shares/"+b.ID, `{"name":"评审协作 · 更新","enabled":true,"permissions":{"comment":true,"checklist":true}}`, ac)
	mustStatus(t, rec, 200)
	var edited BoardShare
	json.Unmarshal(rec.Body.Bytes(), &edited)
	if edited.ShortKey != b.ShortKey || edited.ID != b.ID || edited.Key != b.Key || edited.CreatedAt != b.CreatedAt {
		t.Fatal("编辑导致链接或身份改变")
	}
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+b.ID, fmt.Sprintf(`{"name":"跨看板","board_id":%d,"enabled":true}`, bid+100), ac), 400)
	rec = apiCall(t, h, "GET", "/api/shares", "", ac)
	mustStatus(t, rec, 200)
	var entries []BoardShare
	json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) != 2 {
		t.Fatal("同一个看板的多条分享没有保留")
	}
	if strings.Contains(rec.Body.String(), a.ShortKey) || strings.Contains(rec.Body.String(), b.Key) {
		t.Fatal("列表泄露分享密钥")
	}
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+a.ID, `{"name":"客户只读","enabled":false,"permissions":{}}`, ac), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+a.ShortKey+"/board", "", ag), 403)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+b.ShortKey+"/board", "", bg), 200)
	mustStatus(t, apiCall(t, h, "DELETE", "/api/shares/"+a.ID, "", ac), 200)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+b.ShortKey+"/board", "", bg), 200)
	if _, err := s.GetBoardDetail(bid); err != nil {
		t.Fatal("删除分享改变了看板")
	}
	// 归档后，固定记录仍可管理，但访客不能继续访问或建立会话。
	s.db.Exec("UPDATE boards SET archived=1 WHERE id=?", bid)
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+b.ShortKey+"/board", "", bg), 403)
	mustStatus(t, apiCall(t, h, "POST", "/api/shared/"+b.ShortKey+"/session", `{}`, nil), 403)
	rec = apiCall(t, h, "GET", "/api/shares/"+b.ID, "", ac)
	mustStatus(t, rec, 200)
	var archived BoardShare
	json.Unmarshal(rec.Body.Bytes(), &archived)
	if !archived.BoardArchived || archived.ShortKey != b.ShortKey {
		t.Fatal("归档状态或固定链接读取不一致")
	}
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+b.ID, `{"name":"归档评审记录","enabled":false,"permissions":{}}`, ac), 200)
}

func TestLegacyShareMigrationKeepsLinksAndSessions(t *testing.T) {
	s := testStore(t)
	b, err := s.CreateBoard("原看板", "保留内容", "")
	if err != nil {
		t.Fatal(err)
	}
	d, _ := s.GetBoardDetail(b.ID)
	card, _ := s.CreateCard(d.Columns[0].ID, "保留卡片", 0)
	// 模拟上一版本的唯一看板分享表。
	_, err = s.db.Exec(`DROP TABLE share_sessions; DROP TABLE board_shares;
 CREATE TABLE board_shares(id TEXT PRIMARY KEY,board_id INTEGER NOT NULL UNIQUE REFERENCES boards(id) ON DELETE CASCADE,access_key TEXT NOT NULL,enabled INTEGER NOT NULL,expires_at TEXT NOT NULL,permissions TEXT NOT NULL);
 CREATE TABLE share_sessions(token_hash TEXT PRIMARY KEY,share_id TEXT NOT NULL REFERENCES board_shares(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);`)
	if err != nil {
		t.Fatal(err)
	}
	id, key := strings.Repeat("a", 32), strings.Repeat("b", 64)
	_, err = s.db.Exec(`INSERT INTO board_shares VALUES(?,?,?,1,'','{}')`, id, b.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec(`INSERT INTO share_sessions VALUES(?,?,?)`, tokenHash("legacy-cookie"), id, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
	if err != nil {
		t.Fatal(err)
	}
	p := s.path
	s.Close()
	upgraded, err := openStore(p)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	sh, err := upgraded.shareBy("id", id)
	if err != nil || sh.Key != key || sh.BoardID != b.ID || len(sh.ShortKey) != 22 {
		t.Fatalf("分享迁移丢失身份: %v", err)
	}
	if _, err = upgraded.GetCard(card.ID); err != nil {
		t.Fatal("迁移丢失卡片")
	}
	if n, _ := upgraded.queryInt("SELECT COUNT(*) FROM share_sessions"); n != 1 {
		t.Fatal("迁移丢失访客会话")
	}
	var violations int
	rows, err := upgraded.db.Query("PRAGMA foreign_key_check")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		violations++
	}
	rows.Close()
	if violations != 0 {
		t.Fatal("迁移破坏外键")
	}
	h := (&Server{store: upgraded, hub: NewHub(), dataDir: t.TempDir()}).routes()
	gc := &http.Cookie{Name: "squirrel_share", Value: "legacy-cookie"}
	mustStatus(t, apiCall(t, h, "GET", "/api/shared/"+id+"/board", "", gc), 200)
	mustStatus(t, apiCall(t, h, "POST", "/api/shared/"+id+"/session", fmt.Sprintf(`{"key":%q}`, key), nil), 200)
	mustStatus(t, apiCall(t, h, "POST", "/api/shared/"+sh.ShortKey+"/session", `{}`, nil), 200)
	backups, _ := filepath.Glob(p + ".pre-share-records-*.db")
	if len(backups) != 1 {
		t.Fatal("迁移没有创建一致备份")
	}
	if err := upgraded.migrateShareRecords(); err != nil {
		t.Fatal(err)
	}
	again, _ := upgraded.shareBy("id", id)
	if again.ShortKey != sh.ShortKey {
		t.Fatal("重启改变了短链接")
	}
}
