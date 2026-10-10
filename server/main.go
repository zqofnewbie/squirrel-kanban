package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

//go:embed all:static
var staticFS embed.FS

// Server 持有全部运行时依赖。
type Server struct {
	store   *Store
	hub     *Hub
	dataDir string
	dev     bool
}

func main() {
	addr := flag.String("addr", envOr("KANBAN_ADDR", ":8080"), "监听地址")
	data := flag.String("data", envOr("KANBAN_DATA", "./data"), "数据目录")
	dev := flag.Bool("dev", envBool("KANBAN_DEV"), "开发模式：请求日志 + 放宽 CORS + 首页引导")
	flag.Parse()

	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatalf("无法创建数据目录: %v", err)
	}
	store, err := openStore(filepath.Join(*data, "kanban.db"))
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer store.Close()

	if err := store.ensureSeed(); err != nil {
		log.Fatalf("初始化数据失败: %v", err)
	}
	store.PurgeSessions()
	ensureDir(filesDir(*data))

	srv := &Server{store: store, hub: NewHub(), dataDir: *data, dev: *dev}
	mux := srv.routes()

	var handler http.Handler = mux
	if *dev {
		handler = devMiddleware(mux)
	}

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      0, // SSE 需要长连接
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("看板已启动 http://%s  (数据目录: %s)", *addr, *data)
		if *dev {
			log.Printf("开发模式：前端请访问 Vite 开发服务器（默认 http://127.0.0.1:5173）")
		}
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("服务退出: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	// 认证
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.withAuth(s.handleMe))
	mux.HandleFunc("PATCH /api/auth/password", s.withAuth(s.handleChangePassword))
	mux.HandleFunc("PATCH /api/auth/profile", s.withAuth(s.handleUpdateProfile))

	// 用户管理（仅管理员可写）
	mux.HandleFunc("GET /api/users", s.withAuth(s.handleListUsers))
	mux.HandleFunc("POST /api/users", s.withAdmin(s.handleCreateUser))
	mux.HandleFunc("PATCH /api/users/{id}", s.withAdmin(s.handleUpdateUser))
	mux.HandleFunc("DELETE /api/users/{id}", s.withAdmin(s.handleDeleteUser))

	// 看板
	mux.HandleFunc("GET /api/boards", s.withAuth(s.handleListBoards))
	mux.HandleFunc("POST /api/boards", s.withAuth(s.handleCreateBoard))
	mux.HandleFunc("GET /api/boards/{id}", s.withAuth(s.handleGetBoard))
	mux.HandleFunc("PATCH /api/boards/{id}", s.withAuth(s.handleUpdateBoard))
	mux.HandleFunc("DELETE /api/boards/{id}", s.withAuth(s.handleDeleteBoard))
	mux.HandleFunc("POST /api/boards/{id}/columns", s.withAuth(s.handleCreateColumn))
	mux.HandleFunc("GET /api/boards/{id}/archived", s.withAuth(s.handleArchivedCards))
	mux.HandleFunc("POST /api/boards/{id}/labels", s.withAuth(s.handleCreateLabel))
	mux.HandleFunc("POST /api/boards/{id}/normalize", s.withAuth(s.handleNormalizeBoard))

	// 列
	mux.HandleFunc("POST /api/columns/{id}/cards", s.withAuth(s.handleCreateCard))
	mux.HandleFunc("PATCH /api/columns/{id}", s.withAuth(s.handleUpdateColumn))
	mux.HandleFunc("POST /api/columns/{id}/move", s.withAuth(s.handleMoveColumn))
	mux.HandleFunc("DELETE /api/columns/{id}", s.withAuth(s.handleDeleteColumn))

	// 标签
	mux.HandleFunc("PATCH /api/labels/{id}", s.withAuth(s.handleUpdateLabel))
	mux.HandleFunc("DELETE /api/labels/{id}", s.withAuth(s.handleDeleteLabel))

	// 卡片
	mux.HandleFunc("GET /api/cards/{id}", s.withAuth(s.handleGetCard))
	mux.HandleFunc("PATCH /api/cards/{id}", s.withAuth(s.handleUpdateCard))
	mux.HandleFunc("POST /api/cards/{id}/move", s.withAuth(s.handleMoveCard))
	mux.HandleFunc("DELETE /api/cards/{id}", s.withAuth(s.handleDeleteCard))
	mux.HandleFunc("POST /api/cards/{id}/labels", s.withAuth(s.handleToggleCardLabel))
	mux.HandleFunc("GET /api/cards/{id}/activities", s.withAuth(s.handleCardActivities))
	mux.HandleFunc("POST /api/cards/{id}/checklists", s.withAuth(s.handleCreateChecklist))
	mux.HandleFunc("POST /api/cards/{id}/attachments", s.withAuth(s.handleUploadAttachment))

	// 清单
	mux.HandleFunc("PATCH /api/checklists/{id}", s.withAuth(s.handleUpdateChecklist))
	mux.HandleFunc("DELETE /api/checklists/{id}", s.withAuth(s.handleDeleteChecklist))
	mux.HandleFunc("POST /api/checklists/{id}/items", s.withAuth(s.handleCreateChecklistItem))
	mux.HandleFunc("PATCH /api/items/{id}", s.withAuth(s.handleUpdateChecklistItem))
	mux.HandleFunc("DELETE /api/items/{id}", s.withAuth(s.handleDeleteChecklistItem))

	// 附件
	mux.HandleFunc("DELETE /api/attachments/{id}", s.withAuth(s.handleDeleteAttachment))

	// 实时事件
	mux.HandleFunc("GET /api/events", s.withAuth(s.handleEvents))

	// 静态资源与 SPA 回退
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("静态资源加载失败: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("GET /files/", http.StripPrefix("/files/",
		http.FileServer(http.Dir(filesDir(s.dataDir)))))
	mux.Handle("GET /assets/", fileServer)
	mux.Handle("GET /favicon.svg", fileServer)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || !hasExt(r.URL.Path) {
			if s.dev {
				serveDevIndex(w)
				return
			}
			serveIndex(sub, w)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	return mux
}

// ---------- 开发模式辅助 ----------

// statusWriter 记录状态码，供请求日志使用。
type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(code int) {
	w.code = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// devMiddleware 加上请求日志与本地 CORS，只在 -dev 时启用。
func devMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isLocalOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions && origin != "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)
		if r.URL.Path != "/api/events" { // SSE 长连接不打日志，避免噪音
			log.Printf("%s %s -> %d  %s", r.Method, r.URL.RequestURI(), sw.code, time.Since(start).Round(time.Millisecond))
		}
	})
}

func isLocalOrigin(o string) bool {
	if o == "" {
		return false
	}
	for _, prefix := range []string{"http://localhost:", "http://127.0.0.1:", "https://localhost:", "https://127.0.0.1:"} {
		if strings.HasPrefix(o, prefix) {
			return true
		}
	}
	return false
}

// serveDevIndex 提示开发者前端要走 Vite（5173），避免误用到旧的构建产物。
func serveDevIndex(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>看板 · 开发模式</title>
<style>body{font:14px/1.7 -apple-system,"Segoe UI",system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:0 20px;color:#1f2328}
code{background:#f2f4f7;padding:2px 6px;border-radius:5px;font-size:13px}
a{color:#3b6cf6}</style>
<h2>后端已在运行 ✅</h2>
<p>这是开发模式，前端由 Vite 提供，请访问 <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a></p>
<p>API 与 SSE 由 Vite 代理到后端，浏览器侧始终同源。</p>
<p>默认账号 <code>admin</code> / <code>admin</code>（数据目录 <code>.dev</code>，删掉即重置）。</p>`))
}

func hasExt(p string) bool {
	return filepath.Ext(p) != ""
}

func serveIndex(sub fs.FS, w http.ResponseWriter) {
	data, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.Error(w, "前端资源未构建", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(data)
}

