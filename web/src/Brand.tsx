import { useLanguage } from './useLanguage'
import { t } from './i18n'
export default function Brand({ compact = false }: { compact?: boolean }) {
  useLanguage()
  return (
    <div className="brand">
      <img src="/squirrel-logo.png" width={48} height={48} alt="" aria-hidden="true" />
      {!compact && <span>{t("松鼠看板")}<small>{t("把想法，一件件完成")}</small></span>}
    </div>
  )
}
