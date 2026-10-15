package main

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// Limits password hashing work without trusting client-supplied forwarding headers.
// Bounded memory and short windows keep this suitable for a single-instance deployment.
type loginWindow struct {
	start    time.Time
	attempts int
}
type loginLimiter struct {
	mu      sync.Mutex
	windows map[string]loginWindow
}

func (l *loginLimiter) allow(r *http.Request, now time.Time) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = make(map[string]loginWindow)
	}
	for key, window := range l.windows {
		if now.Sub(window.start) >= time.Minute {
			delete(l.windows, key)
		}
	}
	window, exists := l.windows[host]
	if !exists {
		if len(l.windows) >= 4096 {
			return false
		}
		window.start = now
	}
	if window.attempts >= 10 {
		return false
	}
	window.attempts++
	l.windows[host] = window
	return true
}
