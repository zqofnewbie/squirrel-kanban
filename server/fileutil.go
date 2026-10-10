package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

func ensureDir(dir string) error { return os.MkdirAll(dir, 0o755) }

func copyFile(dest string, src io.Reader) error {
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, src)
	return err
}

func removeFile(path string) {
	if path == "" {
		return
	}
	_ = os.Remove(path)
}

// sanitizeFilename 去掉路径分隔符与控制字符，仅用于展示与下载名。
func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	var b strings.Builder
	for _, r := range name {
		if r == 0 || r == '/' || unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if out == "" || out == "." || out == ".." {
		out = "附件"
	}
	if len([]rune(out)) > 120 {
		out = string([]rune(out)[:120])
	}
	return out
}

func filesDir(dataDir string) string { return filepath.Join(dataDir, "files") }
