package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentPreviewValidatesContentAndSupportsRanges(t *testing.T) {
	s := testStore(t)
	if err := s.CreateUser("admin", "管理员", "test-pass", "admin", false); err != nil {
		t.Fatal(err)
	}
	session, _ := s.CreateSession(1, "test")
	cookie := &http.Cookie{Name: cookieName, Value: session.Token}
	b, _ := s.CreateBoard("附件测试", "", "")
	detail, _ := s.GetBoardDetail(b.ID)
	c, _ := s.CreateCard(detail.Columns[0].ID, "预览", 1)
	data := t.TempDir()
	if err := os.MkdirAll(filesDir(data), 0755); err != nil {
		t.Fatal(err)
	}
	handler := (&Server{store: s, hub: NewHub(), dataDir: data}).routes()
	for _, tc := range []struct {
		name, content, mime string
		status              int
	}{
		{"说明.txt", "<script>alert(1)</script>", "text/plain", 200},
		{"手册.pdf", "%PDF-1.7\nexample", "application/pdf", 200},
		{"伪装.pdf", "<html><script>alert(1)</script></html>", "", 415},
		{"页面.html", "<html>active</html>", "", 415},
		{"矢量.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"><script /></svg>", "", 415},
		{"办公.docx", "PK\x03\x04office", "", 415},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := fmt.Sprintf("/files/%d.bin", len(tc.name))
			if err := os.WriteFile(filepath.Join(data, path), []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			a, err := s.CreateAttachment(c.ID, tc.name, path, int64(len(tc.content)))
			if err != nil {
				t.Fatal(err)
			}
			url := fmt.Sprintf("/api/attachments/%d/preview", a.ID)
			mustStatus(t, apiCall(t, handler, "GET", url, "", nil), 401)
			rec := apiCall(t, handler, "GET", url, "", cookie)
			mustStatus(t, rec, tc.status)
			if tc.status != 200 {
				return
			}
			if !strings.HasPrefix(rec.Header().Get("Content-Type"), tc.mime) || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline") || rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("预览响应缺少正确类型和保护")
			}
			head := apiCall(t, handler, "HEAD", url, "", cookie)
			mustStatus(t, head, 200)
			if head.Body.Len() != 0 || head.Header().Get("Content-Type") != rec.Header().Get("Content-Type") {
				t.Fatal("预览 HEAD 应返回类型且不传输文件内容")
			}
			request := httptest.NewRequest("GET", url, nil)
			request.AddCookie(cookie)
			request.Header.Set("Range", "bytes=0-3")
			rangeResponse := httptest.NewRecorder()
			handler.ServeHTTP(rangeResponse, request)
			mustStatus(t, rangeResponse, 206)
			if rangeResponse.Body.String() != tc.content[:4] {
				t.Fatal("预览分段读取失败")
			}
			if tc.mime == "text/plain" && rec.Header().Get("Content-Security-Policy") == "" {
				t.Fatal("文本预览应隔离执行")
			}
		})
	}
}
