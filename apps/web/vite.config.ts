import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The staff app reaches the API through `/api` on its own origin (KTD30), so the session
// cookie stays first-party and there is no CORS. Locally that is the API's staff listener.
const staffListener = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: staffListener } } },
  preview: { port: 5173, strictPort: true, proxy: { '/api': { target: staffListener } } },
});
