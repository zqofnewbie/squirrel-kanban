package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxBackground = 12 << 20

func validBoardBackground(value string) bool {
	if value == "" || value == "default" {
		return true
	}
	if len(value) == 7 && value[0] == '#' && strings.Trim(strings.ToUpper(value[1:]), "0123456789ABCDEF") == "" {
		return true
	}
	switch value {
	case "preset:grove", "preset:sea", "preset:hills", "preset:orbit":
		return true
	}
	return false
}

func (s *Server) removeBoardBackground(value string) {
	name := strings.TrimPrefix(value, "upload:")
	if value != name && name == filepath.Base(name) {
		removeFile(filepath.Join(s.dataDir, "backgrounds", name))
	}
}

func (s *Server) handleUploadBackground(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	b, err := s.store.GetBoard(id)
	if err != nil {
		writeErr(w, 404, "看板不存在")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBackground+(1<<20))
	if err := r.ParseMultipartForm(maxBackground); err != nil {
		writeErr(w, 400, "图片不能超过 12 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "请选择背景图片")
		return
	}
	defer f.Close()
	if header.Size > maxBackground {
		writeErr(w, 413, "图片不能超过 12 MB")
		return
	}
	head := make([]byte, 512)
	n, err := f.Read(head)
	if err != nil && err != io.EOF {
		writeErr(w, 400, "读取图片失败")
		return
	}
	kind := attachmentPreviewType(header.Filename, head[:n])
	extensions := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif"}
	ext, ok := extensions[kind]
	if !ok {
		writeErr(w, 415, "请选择 PNG、JPG、WebP、GIF 或 AVIF 图片")
		return
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		writeErr(w, 400, "读取图片失败")
		return
	}
	token, err := randomToken(12)
	if err != nil {
		writeErr(w, 500, "保存失败")
		return
	}
	dest := filepath.Join(s.dataDir, "backgrounds", token+ext)
	if err := ensureDir(filepath.Dir(dest)); err != nil {
		writeErr(w, 500, "写入图片失败")
		return
	}
	if err := copyFile(dest, f); err != nil {
		removeFile(dest)
		writeErr(w, 500, "写入图片失败")
		return
	}
	value := "upload:" + token + ext
	if err := s.store.UpdateBoard(id, "", "", value, nil); err != nil {
		removeFile(dest)
		writeErr(w, 500, "保存背景失败")
		return
	}
	s.removeBoardBackground(b.Background)
	b, _ = s.store.GetBoard(id)
	s.publish(id, currentUser(r).Actor, "board.updated", b)
	s.publish(0, currentUser(r).Actor, "board.list", b)
	writeJSON(w, 200, b)
}

func (s *Server) serveBoardBackground(w http.ResponseWriter, r *http.Request, id int64) {
	b, err := s.store.GetBoard(id)
	if err != nil || b.Archived || !strings.HasPrefix(b.Background, "upload:") {
		writeErr(w, 404, "背景图片不存在")
		return
	}
	name := strings.TrimPrefix(b.Background, "upload:")
	if name != filepath.Base(name) {
		writeErr(w, 404, "背景图片不存在")
		return
	}
	f, err := os.Open(filepath.Join(s.dataDir, "backgrounds", name))
	if err != nil {
		writeErr(w, 404, "背景图片不存在")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeErr(w, 404, "背景图片不存在")
		return
	}
	head := make([]byte, 512)
	n, _ := f.Read(head)
	kind := attachmentPreviewType(name, head[:n])
	if !strings.HasPrefix(kind, "image/") {
		writeErr(w, 415, "图片格式不正确")
		return
	}
	f.Seek(0, io.SeekStart)
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

func (s *Server) handleBoardBackground(w http.ResponseWriter, r *http.Request) {
	s.serveBoardBackground(w, r, pathID(r, "id"))
}
func (s *Server) handleSharedBackground(w http.ResponseWriter, r *http.Request, sh *BoardShare) {
	s.serveBoardBackground(w, r, sh.BoardID)
}
