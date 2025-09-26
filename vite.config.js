import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Unearthed/',   // 👈 MUST MATCH your repo name exactly
  plugins: [react()],
})