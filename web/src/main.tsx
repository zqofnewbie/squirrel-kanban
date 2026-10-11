import { createRoot } from 'react-dom/client'
import GlobalNotices from './GlobalNotices'
import App from './App'
import SharedBoard from './SharedBoard'
import { useStore } from './store'
import './index.css'

const shareMatch = location.pathname.match(/^\/s\/([a-f0-9]{32}|[A-Za-z0-9_-]{22})\/?$/)
const isShareRoute = location.pathname === '/s' || location.pathname.startsWith('/s/')
if (!isShareRoute) {
 window.addEventListener('kanban:session-expired', () => useStore.getState().expireSession())
 const page = location.pathname === '/administration' ? 'administration' : location.pathname === '/shares' ? 'shares' : 'boards'
 void useStore.getState().bootstrap().then(() => useStore.getState().setPage(page))
 window.addEventListener('popstate', () => useStore.setState({page: location.pathname === '/administration' ? 'administration' : location.pathname === '/shares' ? 'shares' : 'boards', openCardId:null,search:''}))
}
createRoot(document.getElementById('root')!).render(<>{isShareRoute ? <SharedBoard shareId={shareMatch?.[1] ?? 'invalid'} /> : <App />}<GlobalNotices /></>)
