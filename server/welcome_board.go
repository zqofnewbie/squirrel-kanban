package main

import "strings"

// Add the introductory template once without modifying existing boards. Deleted examples stay deleted.
func (s *Store) ensureWelcomeBoard(userID int64, language string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var done int
	if err = tx.QueryRow("SELECT COUNT(*) FROM app_settings WHERE key='welcome_template_v1'").Scan(&done); err != nil {
		return err
	}
	if done > 0 {
		return nil
	}

	name, description := "开始使用 · 模板看板", "从几个小任务开始，试试拖动、标签与清单。这些示例都可以自由编辑或删除。"
	columns := []string{"待办", "进行中", "已完成"}
	titles := []string{"规划本周的三件事", "准备项目资料", "推进一个任务", "记录讨论与决定", "完成第一步"}
	descriptions := []string{"## 本周目标\n\n写下最重要的三件事，再把每件事拆成小步骤。\n\n- 明确预期结果\n- 为任务设置截止日期\n- 每天检查一次进展", "把相关链接、图片或文档放到这里。\n\n可以上传附件、预览资料，也可以用标签归类。", "把卡片拖到「进行中」，完成后再移到「已完成」。\n\n也可以在详情顶部切换所属列表。", "用评论记录讨论，用描述整理最后的结论。\n\n分享当前看板时，可以分别设置查看、评论和编辑权限。", "你已经了解看板的基本用法。\n\n这个模板属于你，可以改成自己的项目，也可以删除示例重新开始。"}
	labelNames := []string{"优先", "日常"}
	checklist := "本周行动"
	items := []string{"明确一个目标", "列出下一步行动", "检查完成结果"}
	if strings.HasPrefix(strings.ToLower(language), "en") {
		name = "Getting started · Template"
		description = "Start with a few small tasks. Try dragging, labels and checklists. Edit or delete any example."
		columns = []string{"To do", "In progress", "Done"}
		titles = []string{"Plan three priorities this week", "Gather project materials", "Move a task forward", "Capture discussions and decisions", "Complete your first step"}
		descriptions = []string{"## This week's goals\n\nChoose three priorities and break each one into small steps.\n\n- Define the outcome\n- Set a due date\n- Check progress each day", "Keep relevant links, images and documents here.\n\nUpload and preview attachments, and use labels to organize them.", "Drag this card to In progress, then to Done when finished.\n\nYou can also choose a list at the top of card details.", "Use comments for discussion and the description for final decisions.\n\nWhen sharing this board, choose viewing, commenting and editing permissions separately.", "You now know the basics.\n\nThis template is yours: turn it into a project or delete the examples and start fresh."}
		labelNames = []string{"Priority", "Routine"}
		checklist = "Weekly actions"
		items = []string{"Define a goal", "Choose the next action", "Review the result"}
	}
	now := nowISO()
	result, e := tx.Exec("INSERT INTO boards(name,description,background,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,1)", name, description, "preset:orbit", now, now)
	if e != nil {
		return e
	}
	bid, _ := result.LastInsertId()
	ids := make([]int64, 3)
	for i, label := range columns {
		r, e := tx.Exec("INSERT INTO board_columns(board_id,name,position,color) VALUES(?,?,?,?)", bid, label, (i+1)*1024, []string{"#629FF0", "#B18AE7", "#5EC79A"}[i])
		if e != nil {
			return e
		}
		ids[i], _ = r.LastInsertId()
	}
	cards := make([]int64, 5)
	for i, title := range titles {
		column := []int{0, 0, 1, 1, 2}[i]
		cover := ""
		if i == 0 {
			cover = "#BDD7FC"
		}
		r, e := tx.Exec("INSERT INTO cards(column_id,title,description,cover,position,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", ids[column], title, descriptions[i], cover, (i+1)*1024, userID, now, now)
		if e != nil {
			return e
		}
		cards[i], _ = r.LastInsertId()
	}
	for i, label := range labelNames {
		r, e := tx.Exec("INSERT INTO labels(board_id,name,color,position) VALUES(?,?,?,?)", bid, label, []string{"#F4777F", "#5EC79A"}[i], (i+1)*1024)
		if e != nil {
			return e
		}
		lid, _ := r.LastInsertId()
		if _, e = tx.Exec("INSERT INTO card_labels(card_id,label_id) VALUES(?,?)", cards[i], lid); e != nil {
			return e
		}
	}
	r, e := tx.Exec("INSERT INTO checklists(card_id,title,position) VALUES(?,?,1024)", cards[0], checklist)
	if e != nil {
		return e
	}
	cl, _ := r.LastInsertId()
	for i, text := range items {
		if _, e = tx.Exec("INSERT INTO checklist_items(checklist_id,text,done,position) VALUES(?,?,?,?)", cl, text, boolInt(i == 0), (i+1)*1024); e != nil {
			return e
		}
	}
	if _, err = tx.Exec("INSERT INTO app_settings(key,value) VALUES('welcome_template_v1','done')"); err != nil {
		return err
	}
	return tx.Commit()
}
