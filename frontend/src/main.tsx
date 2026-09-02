import '@fontsource/golos-text/cyrillic-400.css'
import '@fontsource/golos-text/cyrillic-500.css'
import '@fontsource/golos-text/cyrillic-600.css'
import '@fontsource/golos-text/400.css'
import '@fontsource/golos-text/500.css'
import '@fontsource/golos-text/600.css'
import '@fontsource/jetbrains-mono/cyrillic-400.css'
import '@fontsource/jetbrains-mono/cyrillic-500.css'
import '@fontsource/jetbrains-mono/cyrillic-600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
// Базовая таблица React Flow идёт ПЕРЕД tokens.css: у правил вида
// `.react-flow__handle` одинаковая специфичность, и побеждает та, что позже.
// Пока она импортировалась внутри TopologyView, дизайн-система проигрывала —
// гнёзда оставались дефолтными 6px вместо задуманных 12, кабели 1px вместо 2.
import '@xyflow/react/dist/style.css'
import './shared/ui/tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
