package main

import (
	"encoding/json"
	"net/http"
	"sync"
)

type subscriber struct {
	boardID int64 // 0 表示接收全部看板的事件
	ch      chan []byte
}

// Hub 是进程内的 SSE 广播中心。规模定位为单实例，不做跨节点分发。
type Hub struct {
	mu   sync.RWMutex
	subs map[*subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[*subscriber]struct{}{}}
}

func (h *Hub) Subscribe(boardID int64) *subscriber {
	s := &subscriber{boardID: boardID, ch: make(chan []byte, 64)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *Hub) Unsubscribe(s *subscriber) {
	h.mu.Lock()
	if _, ok := h.subs[s]; ok {
		delete(h.subs, s)
		close(s.ch)
	}
	h.mu.Unlock()
}

func (h *Hub) Publish(ev Event) {
	payload, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.subs {
		if s.boardID != 0 && s.boardID != ev.BoardID && ev.BoardID != 0 {
			continue
		}
		select {
		case s.ch <- payload:
		default:
			// 慢消费者直接丢弃最新一条，避免阻塞写路径
		}
	}
}

// 便捷构造器：广播某看板的变更
func (s *Server) publish(boardID int64, actor, typ string, payload any) {
	s.hub.Publish(Event{Type: typ, BoardID: boardID, Actor: actor, Payload: payload})
}

// ---------- SSE 端点 ----------

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "未登录")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "不支持流式响应")
		return
	}

	boardID := int64(0)
	if v := r.URL.Query().Get("board_id"); v != "" {
		boardID = parseInt64(v)
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(": connected\n\n"))
	flusher.Flush()

	sub := s.hub.Subscribe(boardID)
	defer s.hub.Unsubscribe(sub)

	// 告诉客户端自己的 actor，用于忽略自己触发的回声事件
	hello, _ := json.Marshal(Event{Type: "hello", Actor: u.Actor, Payload: map[string]any{"user": u.User}})
	_, _ = w.Write([]byte("data: " + string(hello) + "\n\n"))
	flusher.Flush()

	ctx := r.Context()
	ping := make(chan struct{})
	go func() {
		t := timeTicker()
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				select {
				case ping <- struct{}{}:
				default:
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case payload := <-sub.ch:
			active, err := s.userFromRequest(r)
			if err != nil || (boardID != 0 && !s.store.canBoard(active, boardID)) {
				return
			}
			var event Event
			if json.Unmarshal(payload, &event) != nil {
				continue
			}
			if event.BoardID == 0 {
				payload, _ = json.Marshal(Event{Type: event.Type, Actor: event.Actor})
			} else if !s.store.canBoard(active, event.BoardID) {
				continue
			}
			_, _ = w.Write([]byte("data: " + string(payload) + "\n\n"))
			flusher.Flush()
		case <-ping:
			active, err := s.userFromRequest(r)
			if err != nil || (boardID != 0 && !s.store.canBoard(active, boardID)) {
				return
			}
			_, _ = w.Write([]byte(": ping\n\n"))
			flusher.Flush()
		}
	}
}
