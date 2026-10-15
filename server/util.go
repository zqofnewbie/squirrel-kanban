package main

import (
	"encoding/json"
	"errors"
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
	decoder := json.NewDecoder(io.LimitReader(r.Body, 4<<20))
	if err := decoder.Decode(v); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}

func timeTicker() *time.Ticker { return time.NewTicker(25 * time.Second) }

func strPtr(s string) *string { return &s }

func boolPtr(b bool) *bool { return &b }

func envBool(k string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(k)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
