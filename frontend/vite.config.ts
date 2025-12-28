import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',            // important for Vercel routing
  build: {
    outDir: 'dist',     // Vercel expects this
  },
  server: {
    port: 5173,         // optional, for local dev consistency
  },
});
