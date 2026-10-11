import { useSyncExternalStore } from 'react'
import { subscribeLanguage, getLanguage } from './i18n'
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage) }
