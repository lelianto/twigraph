import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const container = document.getElementById('root')
if (container === null) throw new Error('The window has no root element to render into')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
