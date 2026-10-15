package main

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// Limits count Unicode characters, so Chinese and English use the same contract.
func validateCardFields(title, description, dueDate, cover *string) error {
	if title != nil && (strings.TrimSpace(*title) == "" || utf8.RuneCountInString(*title) > 250) {
		return errors.New("标题需要 1–250 个字符")
	}
	if description != nil && utf8.RuneCountInString(*description) > 20000 {
		return errors.New("描述最多 20000 个字符")
	}
	if dueDate != nil && *dueDate != "" {
		if _, err := time.Parse("2006-01-02", *dueDate); err != nil {
			return errors.New("日期格式不正确")
		}
	}
	if cover != nil && *cover != "" {
		if len(*cover) != 7 || (*cover)[0] != '#' {
			return errors.New("封面颜色格式不正确")
		}
		for _, ch := range (*cover)[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", ch) {
				return errors.New("封面颜色格式不正确")
			}
		}
	}
	return nil
}
