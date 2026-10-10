import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import './index.css'

useStore.getState().bootstrap()

createRoot(document.getElementById('root')!).render(<App />)
