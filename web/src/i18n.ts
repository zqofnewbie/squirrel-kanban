import english from './en.json'
export type Language = 'zh' | 'en'
export const languageKey = 'squirrel.language.v1'
export const themeKey = 'squirrel.theme.preference.v1'
export function preference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Private browsing may disable storage. */
  }
}
export function detectLanguage(saved: string | null, languages: readonly string[]): Language {
  if (saved === 'zh' || saved === 'en') return saved
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export let language = detectLanguage(
  preference(languageKey),
  navigator.languages?.length ? navigator.languages : [navigator.language],
)
export function locale() {
  return language === 'zh' ? 'zh-CN' : 'en-US'
}
export function t(source: string, values: unknown[] = []): string {
  const template =
    language === 'en' ? ((english as Record<string, string>)[source] ?? source) : source
  return template.replace(/\{(\d+)\}/g, (match, index) =>
    index < values.length ? String(values[index] ?? '') : match,
  )
}
export function setLanguage(next: Language) {
  if (next === language) return
  language = next
  savePreference(languageKey, next)
  document.documentElement.lang = locale()
  for (const listener of languageListeners) listener()
}
document.documentElement.lang = locale()

export function workspaceName(space: { id: number; name: string }) {
  return space.id === 1 && space.name === '默认工作空间' ? t('默认工作空间') : space.name
}
export function detectTheme(saved: string | null, dark: boolean): 'dark' | 'light' {
  return saved === 'dark' || saved === 'light' ? saved : dark ? 'dark' : 'light'
}

export function countText(count: number, kind: 'boards' | 'lists' | 'cards'): string {
  const zh = { boards: '个看板', lists: '个列表', cards: '张卡片' }
  return language === 'zh'
    ? `${count} ${zh[kind]}`
    : `${count} ${count === 1 ? kind.slice(0, -1) : kind}`
}

// The server appends role markers; translate only that metadata, never the nickname.
export function commentAuthor(author: string): string {
  const match = author.match(/^(.*)（(管理员|子管理员|成员|访客)）$/)
  if (!match) return author
  const name = match[1] === '访客' ? (language === 'en' ? 'Guest' : '访客') : match[1]
  return language === 'en'
    ? `${name} (${({ 管理员: 'administrator', 子管理员: 'workspace administrator', 成员: 'member', 访客: 'guest' } as Record<string, string>)[match[2]]})`
    : author
}

const languageListeners = new Set<() => void>()
export function subscribeLanguage(listener: () => void) {
  languageListeners.add(listener)
  return () => {
    languageListeners.delete(listener)
  }
}
export function getLanguage() {
  return language
}
