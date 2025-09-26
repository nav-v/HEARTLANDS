import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/UNEARTHED/',   // 👈 MUST MATCH your repo name exactly
  plugins: [react()],
})