package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestOfficePreviewCachesPDFAndChecksEveryAccess(t *testing.T) {
	s := testStore(t)
	s.CreateUser("admin", "管理员", "test-pass", "admin", false)
	session, _ := s.CreateSession(1, "test")
	admin := &http.Cookie{Name: cookieName, Value: session.Token}
	board, _ := s.CreateBoard("文档测试", "", "")
	detail, _ := s.GetBoardDetail(board.ID)
	card, _ := s.CreateCard(detail.Columns[0].ID, "文档", 1)
	data := t.TempDir()
	os.MkdirAll(filesDir(data), 0700)
	content := []byte("PK\x03\x04test-office")
	os.WriteFile(filepath.Join(filesDir(data), "office.docx"), content, 0600)
	attachment, _ := s.CreateAttachment(card.ID, "中文文档.docx", "/files/office.docx", int64(len(content)))
	var calls atomic.Int32
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "POST" || r.URL.Path != "/forms/libreoffice/convert" {
			t.Error("错误的转换协议")
		}
		file, header, err := r.FormFile("files")
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		defer file.Close()
		body, _ := io.ReadAll(file)
		if header.Filename != "input.docx" || string(body) != string(content) || r.FormValue("exportFormFields") != "false" {
			t.Error("转换输入不正确")
		}
		w.Header().Set("Content-Type", "application/pdf")
		io.WriteString(w, "%PDF-1.7\nprivate-preview")
	}))
	defer converter.Close()
	srv := &Server{store: s, hub: NewHub(), dataDir: data, previewURL: converter.URL}
	h := srv.routes()
	path := fmt.Sprintf("/api/attachments/%d/preview?office=1", attachment.ID)
	mustStatus(t, apiCall(t, h, "GET", path, "", nil), 401)
	mustStatus(t, apiCall(t, h, "HEAD", path, "", admin), 200)
	rec := apiCall(t, h, "GET", path, "", admin)
	mustStatus(t, rec, 200)
	if calls.Load() != 1 || rec.Header().Get("Content-Type") != "application/pdf" || rec.Header().Get("Cache-Control") != "private, no-store" || rec.Body.String() != "%PDF-1.7\nprivate-preview" {
		t.Fatal("预览未缓存或缺少保护")
	}
	rangeRequest := httptest.NewRequest("GET", path, nil)
	rangeRequest.AddCookie(admin)
	rangeRequest.Header.Set("Range", "bytes=0-4")
	ranged := httptest.NewRecorder()
	h.ServeHTTP(ranged, rangeRequest)
	mustStatus(t, ranged, 206)
	if ranged.Body.String() != "%PDF-" {
		t.Fatal("PDF 分段读取失败")
	}
	response := apiCall(t, h, "POST", "/api/shares", fmt.Sprintf(`{"board_id":%d,"name":"文档分享","enabled":true,"permissions":{"download":true}}`, board.ID), admin)
	mustStatus(t, response, 201)
	var share BoardShare
	json.Unmarshal(response.Body.Bytes(), &share)
	guestPath := "/api/shared/" + share.ShortKey
	guestResponse := apiCall(t, h, "POST", guestPath+"/session", `{}`, nil)
	mustStatus(t, guestResponse, 200)
	var guest *http.Cookie
	for _, cookie := range guestResponse.Result().Cookies() {
		if cookie.Value != "" {
			guest = cookie
			break
		}
	}
	preview := fmt.Sprintf("%s/attachments/%d?preview=1&office=1", guestPath, attachment.ID)
	mustStatus(t, apiCall(t, h, "GET", preview, "", guest), 200)
	other, _ := s.CreateBoard("私有", "", "")
	otherDetail, _ := s.GetBoardDetail(other.ID)
	privateCard, _ := s.CreateCard(otherDetail.Columns[0].ID, "私有文档", 1)
	privateAttachment, _ := s.CreateAttachment(privateCard.ID, "私有.docx", "/files/office.docx", int64(len(content)))
	mustStatus(t, apiCall(t, h, "GET", fmt.Sprintf("%s/attachments/%d?preview=1&office=1", guestPath, privateAttachment.ID), "", guest), 404)
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+share.ID, `{"name":"文档分享","enabled":true,"permissions":{}}`, admin), 200)
	mustStatus(t, apiCall(t, h, "GET", preview, "", guest), 403)
	mustStatus(t, apiCall(t, h, "PATCH", "/api/shares/"+share.ID, `{"name":"文档分享","enabled":false,"permissions":{"download":true}}`, admin), 200)
	mustStatus(t, apiCall(t, h, "GET", preview, "", guest), 403)
	mustStatus(t, apiCall(t, h, "DELETE", fmt.Sprintf("/api/attachments/%d", attachment.ID), "", admin), 200)
	if _, err := os.Stat(filepath.Join(data, "previews", "office.docx.pdf")); !os.IsNotExist(err) {
		t.Fatal("附件删除未清理预览缓存")
	}
	mustStatus(t, apiCall(t, h, "GET", path, "", admin), 404)
}

func TestOfficePreviewDisabledAndInvalidConverterOutput(t *testing.T) {
	s := testStore(t)
	s.CreateUser("admin", "管理员", "test-pass", "admin", false)
	session, _ := s.CreateSession(1, "test")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	board, _ := s.CreateBoard("文档", "", "")
	detail, _ := s.GetBoardDetail(board.ID)
	card, _ := s.CreateCard(detail.Columns[0].ID, "文档", 1)
	data := t.TempDir()
	os.MkdirAll(filesDir(data), 0700)
	os.WriteFile(filepath.Join(filesDir(data), "old.doc"), []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, 0600)
	a, _ := s.CreateAttachment(card.ID, "文档.doc", "/files/old.doc", 8)
	srv := &Server{store: s, hub: NewHub(), dataDir: data}
	h := srv.routes()
	path := fmt.Sprintf("/api/attachments/%d/preview?office=1", a.ID)
	mustStatus(t, apiCall(t, h, "GET", path, "", cookie), 503)
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "<script>invalid PDF</script>") }))
	defer converter.Close()
	srv.previewURL = converter.URL
	mustStatus(t, apiCall(t, h, "GET", path, "", cookie), 422)
	if _, err := os.Stat(filepath.Join(data, "previews", "old.doc.pdf")); !os.IsNotExist(err) {
		t.Fatal("转换失败不应缓存错误响应")
	}
	if officeExtension("恶意.doc", []byte("<html>script</html>")) != "" || officeExtension("宏.exe", []byte("PK\x03\x04")) != "" {
		t.Fatal("不能仅根据扩展名允许不匹配内容")
	}
}
