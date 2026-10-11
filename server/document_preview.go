package main

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Office rendering is optional; cached PDFs remain private and go through the
// same authorization and share checks as the original attachment on every request.
var documentQueue = make(chan struct{}, 8)
var documentWorker = make(chan struct{}, 1)

func officeExtension(name string, head []byte) string {
	ext := strings.ToLower(filepath.Ext(name))
	zip := len(head) >= 4 && bytes.Equal(head[:4], []byte{'P', 'K', 3, 4})
	ole := len(head) >= 8 && bytes.Equal(head[:8], []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	switch ext {
	case ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".docm", ".xlsm", ".pptm", ".ppsx", ".pages", ".numbers", ".key":
		if zip {
			return ext
		}
	case ".doc", ".xls", ".ppt", ".pps":
		if ole {
			return ext
		}
		// Some Word exports use RTF content in a .doc container.
		if ext == ".doc" && bytes.HasPrefix(head, []byte("{\\rtf")) {
			return ext
		}
	case ".rtf":
		if bytes.HasPrefix(head, []byte("{\\rtf")) {
			return ext
		}
	}
	return ""
}

func (s *Server) serveDocumentPreview(w http.ResponseWriter, r *http.Request, a *Attachment, source *os.File, ext string) {
	ctx, cancel := context.WithTimeout(r.Context(), 65*time.Second)
	defer cancel()
	cacheDir := filepath.Join(s.dataDir, "previews")
	cachePath := filepath.Join(cacheDir, filepath.Base(a.Path)+".pdf")
	openCache := func() (*os.File, error) {
		cached, err := os.Open(cachePath)
		if err != nil {
			return nil, err
		}
		original, e1 := source.Stat()
		info, e2 := cached.Stat()
		if e1 != nil || e2 != nil || !info.Mode().IsRegular() || info.ModTime().Before(original.ModTime()) {
			cached.Close()
			return nil, errors.New("stale preview")
		}
		return cached, nil
	}
	cached, err := openCache()
	if err != nil {
		if s.previewURL == "" && s.soffice == "" {
			writeErr(w, 503, "文档预览尚未启用，请下载原文件查看")
			return
		}
		queueHeld := false
		select {
		case documentQueue <- struct{}{}:
			queueHeld = true
			defer func() {
				if queueHeld {
					<-documentQueue
				}
			}()
		default:
			writeErr(w, 429, "文档预览正在忙，请稍后重试")
			return
		}
		workerHeld := false
		select {
		case documentWorker <- struct{}{}:
			workerHeld = true
			defer func() {
				if workerHeld {
					<-documentWorker
				}
			}()
		case <-ctx.Done():
			writeErr(w, 504, "文档预览超时，请稍后重试或下载查看")
			return
		}
		cached, err = openCache() // Another viewer may have completed this conversion while we queued.
		if err != nil {
			if err = os.MkdirAll(cacheDir, 0700); err == nil {
				err = s.convertDocument(ctx, source, ext, cacheDir, cachePath)
			}
			if err != nil {
				log.Printf("文档预览转换失败 (attachment=%d): %v", a.ID, err)
				if ctx.Err() != nil {
					writeErr(w, 504, "文档预览超时，请下载原文件查看")
				} else {
					writeErr(w, 422, "无法预览此文档，请确认文件未损坏或加密，也可下载查看")
				}
				return
			}
			cached, err = openCache()
			if err != nil {
				writeErr(w, 500, "读取文档预览失败")
				return
			}
		}
		<-documentWorker
		workerHeld = false
		<-documentQueue
		queueHeld = false
	}
	defer cached.Close()
	info, err := cached.Stat()
	if err != nil {
		writeErr(w, 500, "读取文档预览失败")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": strings.TrimSuffix(a.Name, filepath.Ext(a.Name)) + ".pdf"}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, a.Name+".pdf", info.ModTime(), cached)
}

func (s *Server) convertDocument(ctx context.Context, source *os.File, ext, cacheDir, cachePath string) error {
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return err
	}
	job, err := os.MkdirTemp(cacheDir, ".render-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(job)
	output := filepath.Join(job, "input.pdf")
	if s.previewURL != "" {
		var payload bytes.Buffer
		form := multipart.NewWriter(&payload)
		part, err := form.CreateFormFile("files", "input"+ext)
		if err != nil {
			return err
		}
		if _, err = io.Copy(part, io.LimitReader(source, 32<<20)); err != nil {
			return err
		}
		if err = form.WriteField("exportFormFields", "false"); err != nil {
			return err
		}
		if err = form.Close(); err != nil {
			return err
		}
		request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(s.previewURL, "/")+"/forms/libreoffice/convert", &payload)
		if err != nil {
			return err
		}
		request.Header.Set("Content-Type", form.FormDataContentType())
		client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(request)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return fmt.Errorf("converter status %d", response.StatusCode)
		}
		dest, err := os.Create(output)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(dest, io.LimitReader(response.Body, (64<<20)+1))
		closeErr := dest.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n > 64<<20 {
			return errors.New("preview too large")
		}
	} else {
		input := filepath.Join(job, "input"+ext)
		if err := copyFile(input, io.LimitReader(source, 32<<20)); err != nil {
			return err
		}
		profile := filepath.Join(job, "profile")
		profileURL := (&url.URL{Scheme: "file", Path: filepath.ToSlash(profile)}).String()
		command := exec.CommandContext(ctx, s.soffice, "-env:UserInstallation="+profileURL, "--headless", "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf", "--outdir", job, input)
		// Headless macOS builds use Fontconfig rather than CoreText. Point them
		// at the system's Chinese fonts and a writable per-job cache.
		if runtime.GOOS == "darwin" && os.Getenv("FONTCONFIG_FILE") == "" {
			var escaped bytes.Buffer
			xml.EscapeText(&escaped, []byte(filepath.Join(job, "font-cache")))
			config := `<?xml version="1.0"?><fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir><cachedir>` + escaped.String() + `</cachedir><alias><family>sans-serif</family><prefer><family>Arial</family><family>Heiti SC</family></prefer></alias></fontconfig>`
			configPath := filepath.Join(job, "fonts.conf")
			if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
				return err
			}
			command.Env = append(os.Environ(), "FONTCONFIG_FILE="+configPath)
		}
		if err := command.Run(); err != nil {
			return err
		}
	}
	file, err := os.Open(output)
	if err != nil {
		return err
	}
	head := make([]byte, 5)
	_, readErr := io.ReadFull(file, head)
	info, statErr := file.Stat()
	file.Close()
	if readErr != nil || string(head) != "%PDF-" || statErr != nil || info.Size() > 64<<20 {
		return errors.New("converter did not return a valid PDF")
	}
	// An attachment might have been deleted while conversion was in progress.
	if _, err := os.Stat(source.Name()); err != nil {
		return err
	}
	return os.Rename(output, cachePath)
}
