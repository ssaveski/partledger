import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The portal's own response headers (KTD21). Production serves the same from the portal origin
// (U17, U24), together with a strict Content-Security-Policy that the dev server's inline
// preamble would break here.
const portalHeaders = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true, headers: portalHeaders },
  preview: { port: 5174, strictPort: true, headers: portalHeaders },
});
