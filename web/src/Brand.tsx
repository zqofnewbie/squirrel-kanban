import { useLanguage } from './useLanguage'
import { t } from './i18n'
import SquirrelLogo from './SquirrelLogo'
export default function Brand({ compact = false, animated = false }: { compact?: boolean; animated?: boolean }) {
  useLanguage()
  return (
    <div className="brand">
      {animated ? <SquirrelLogo /> : <img src="/squirrel-logo.png" width={48} height={48} alt="" aria-hidden="true" />}
      {!compact && <span>{t("松鼠看板")}<small>{t("把想法，一件件完成")}</small></span>}
    </div>
  )
}
