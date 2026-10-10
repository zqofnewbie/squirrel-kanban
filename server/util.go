package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func parseInt64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

func pathID(r *http.Request, name string) int64 {
	return parseInt64(r.PathValue(name))
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(v)
}

func timeTicker() *time.Ticker { return time.NewTicker(25 * time.Second) }

func strPtr(s string) *string { return &s }

func boolPtr(b bool) *bool { return &b }

func envBool(k string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(k)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}
