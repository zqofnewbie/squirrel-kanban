// Text labels avoid missing modifier glyphs in bundled CJK fonts.
export const primaryKey = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'Cmd' : 'Ctrl'
export const shortcut = (key: string) => `${primaryKey} + ${key}`
