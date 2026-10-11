package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackgroundUploadPermissionsReplacementAndPersistence(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("admin", "管理员", "test-pass", "admin", false); err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(1, "test")
	admin := &http.Cookie{Name: cookieName, Value: session.Token}
	b, _ := s.CreateBoard("背景测试", "", "")
	other, _ := s.CreateBoard("另一看板", "", "")
	data := t.TempDir()
	h := (&Server{store: s, hub: NewHub(), dataDir: data}).routes()
	path := fmt.Sprintf("/api/boards/%d/background", b.ID)
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 70, G: 160, B: 220, A: 255})
	var imageBytes bytes.Buffer
	png.Encode(&imageBytes, img)
	upload := func(content []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("file", "背景.png")
		part.Write(content)
		writer.Close()
		r := httptest.NewRequest("POST", path, &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		if cookie != nil {
			r.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	mustStatus(t, upload(imageBytes.Bytes(), nil), 401)
	mustStatus(t, upload([]byte("<html><script>alert(1)</script></html>"), admin), 415)
	mustStatus(t, upload(imageBytes.Bytes(), admin), 200)
	saved, _ := s.GetBoard(b.ID)
	if !strings.HasPrefix(saved.Background, "upload:") {
		t.Fatal("上传背景没有持久化")
	}
	filename := filepath.Join(data, "backgrounds", strings.TrimPrefix(saved.Background, "upload:"))
	mustStatus(t, apiCall(t, h, "GET", path, "", nil), 401)
	rec := apiCall(t, h, "GET", path, "", admin)
	mustStatus(t, rec, 200)
	if rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("图片应按真实类型提供且不能公开缓存")
	}
	mustStatus(t, apiCall(t, h, "PATCH", fmt.Sprintf("/api/boards/%d", other.ID), fmt.Sprintf(`{"background":%q}`, saved.Background), admin), 400)
	shareResponse := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"只读","enabled":true,"permissions":{}}`, b.ID), admin)
	mustStatus(t, shareResponse, 201)
	var sh BoardShare
	json.Unmarshal(shareResponse.Body.Bytes(), &sh)
	guestPath := "/api/shared/" + sh.ShortKey
	guestResponse := apiCall(t, h, "POST", guestPath+"/session", `{}`, nil)
	mustStatus(t, guestResponse, 200)
	var guest *http.Cookie
	for _, cookie := range guestResponse.Result().Cookies() {
		if cookie.Value != "" {
			guest = cookie
			break
		}
	}
	if guest == nil {
		t.Fatal("分享会话缺失")
	}
	mustStatus(t, apiCall(t, h, "GET", guestPath+"/background", "", guest), 200)
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+sh.ID, `{"name":"只读","enabled":false,"permissions":{}}`, admin), 200)
	mustStatus(t, apiCall(t, h, "GET", guestPath+"/background", "", guest), 403)
	boardPath := fmt.Sprintf("/api/boards/%d", b.ID)
	mustStatus(t, apiCall(t, h, "PATCH", boardPath, `{"name":"不应修改","background":"https://example.com/image.png"}`, admin), 400)
	still, _ := s.GetBoard(b.ID)
	if still.Name != b.Name || still.Background != saved.Background {
		t.Fatal("无效背景请求不应修改其他字段")
	}
	mustStatus(t, apiCall(t, h, "PATCH", boardPath, `{"background":"preset:grove"}`, admin), 200)
	if _, err := os.Stat(filename); !os.IsNotExist(err) {
		t.Fatal("替换背景后应清理旧上传文件")
	}
	mustStatus(t, apiCall(t, h, "GET", path, "", admin), 404)
}

func TestChecklistRenamePreservesItems(t *testing.T) {
	s := testStore(t)
	s.CreateUser("admin", "管理员", "test-pass", "admin", false)
	session, _ := s.CreateSession(1, "test")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	b, _ := s.CreateBoard("清单", "", "")
	detail, _ := s.GetBoardDetail(b.ID)
	c, _ := s.CreateCard(detail.Columns[0].ID, "任务", 1)
	cl, _ := s.CreateChecklist(c.ID, "原名称")
	item, _ := s.CreateChecklistItem(cl.ID, "保留子项")
	done := true
	s.UpdateChecklistItem(item.ID, "", &done)
	h := (&Server{store: s, hub: NewHub(), dataDir: t.TempDir()}).routes()
	path := fmt.Sprintf("/api/checklists/%d", cl.ID)
	mustStatus(t, apiCall(t, h, "PATCH", path, `{"title":"上线准备"}`, cookie), 200)
	mustStatus(t, apiCall(t, h, "PATCH", path, `{"title":"  "}`, cookie), 400)
	fresh, _ := s.GetCard(c.ID)
	if fresh.Checklists[0].Title != "上线准备" || len(fresh.Checklists[0].Items) != 1 || fresh.Checklists[0].Items[0].ID != item.ID || !fresh.Checklists[0].Items[0].Done {
		t.Fatal("重命名应完整保留子项与完成状态")
	}
}
