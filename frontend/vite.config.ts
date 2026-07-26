import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // Vite 8 собирает через rolldown: карта «имя чанка → список пакетов»
    // (manualChunks) им не принимается, разбиение задаётся группами с
    // регуляркой по пути модуля.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|@tanstack[\\/]react-query)[\\/]/,
            },
            {
              name: 'codemirror',
              test: /node_modules[\\/](@uiw[\\/]react-codemirror|@codemirror|@lezer|codemirror)[\\/]/,
            },
            { name: 'xyflow', test: /node_modules[\\/]@xyflow[\\/]/ },
          ],
        },
      },
    },
  },
})
