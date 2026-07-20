import '@fontsource/ibm-plex-sans/cyrillic-400.css'
import '@fontsource/ibm-plex-sans/cyrillic-600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/cyrillic-400.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './shared/ui/tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
