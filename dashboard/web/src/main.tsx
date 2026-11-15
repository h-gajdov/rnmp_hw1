import '@fontsource-variable/overpass'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No StrictMode: in development it runs effects twice, which would open and
// immediately close a second Socket.IO connection and MapLibre map.
createRoot(document.getElementById('root')!).render(<App />)
