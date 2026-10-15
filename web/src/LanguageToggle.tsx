import { useLanguage } from './useLanguage'
import { language, setLanguage } from './i18n'
export default function LanguageToggle() {
  useLanguage()
  const label = language === 'zh' ? 'Switch to English' : '切换为中文'
  return (
    <button
      type="button"
      className="language-toggle"
      aria-label={label}
      title={label}
      onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
    >
      {language === 'zh' ? 'EN' : '中文'}
    </button>
  )
}
