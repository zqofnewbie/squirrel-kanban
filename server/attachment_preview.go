package main

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) handleAttachmentPreview(w http.ResponseWriter, r *http.Request) {
	a, err := s.store.GetAttachment(pathID(r, "id"))
	if err != nil {
		writeErr(w, 404, "附件不存在")
		return
	}
	s.serveAttachment(w, r, a, true)
}

// Inline only inert browser formats. HTML/SVG and executable files always download.
func attachmentPreviewType(name string, head []byte) string {
	detected := strings.Split(http.DetectContentType(head), ";")[0]
	switch detected {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon", "application/pdf",
		"video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/wave", "audio/aiff", "audio/midi", "application/ogg":
		return detected
	}
	// These formats are containers with signatures not recognized by DetectContentType.
	ext := strings.ToLower(filepath.Ext(name))
	if len(head) >= 12 && string(head[4:8]) == "ftyp" {
		brand := string(head[8:12])
		if ext == ".avif" && (brand == "avif" || brand == "avis") {
			return "image/avif"
		}
		if ext == ".m4a" && brand == "M4A " {
			return "audio/mp4"
		}
		if ext == ".mov" && brand == "qt  " {
			return "video/quicktime"
		}
	}
	switch ext {
	case ".txt", ".md", ".csv", ".json", ".log", ".xml", ".yaml", ".yml", ".toml", ".ini", ".css", ".js", ".ts", ".py", ".go", ".sql":
		if detected == "text/plain" || detected == "text/xml" || detected == "text/html" {
			return "text/plain; charset=utf-8"
		}
	}
	return ""
}

func (s *Server) serveAttachment(w http.ResponseWriter, r *http.Request, a *Attachment, preview bool) {
	if !strings.HasPrefix(a.Path, "/files/") || strings.TrimPrefix(a.Path, "/files/") != filepath.Base(a.Path) {
		writeErr(w, 404, "附件不存在")
		return
	}
	f, err := os.Open(filepath.Join(filesDir(s.dataDir), filepath.Base(a.Path)))
	if err != nil {
		writeErr(w, 404, "附件不存在")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeErr(w, 404, "附件不存在")
		return
	}
	disposition := "attachment"
	if preview {
		head := make([]byte, 512)
		n, err := f.Read(head)
		if err != nil && err != io.EOF {
			writeErr(w, 500, "读取附件失败")
			return
		}
		kind := attachmentPreviewType(a.Name, head[:n])
		if kind == "" {
			if ext := officeExtension(a.Name, head[:n]); ext != "" && r.URL.Query().Get("office") == "1" {
				s.serveDocumentPreview(w, r, a, f, ext)
				return
			}
			writeErr(w, 415, "此格式暂不支持预览，请下载查看")
			return
		}
		w.Header().Set("Content-Type", kind)
		if strings.HasPrefix(kind, "text/") {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		}
		disposition = "inline"
		if _, err = f.Seek(0, io.SeekStart); err != nil {
			writeErr(w, 500, "读取附件失败")
			return
		}
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": a.Name}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, a.Name, info.ModTime(), f)
}
