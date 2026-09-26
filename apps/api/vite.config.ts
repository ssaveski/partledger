import { defineConfig } from 'vite';

// The API ships as one Node bundle; workspace libraries are TypeScript sources, so
// they are bundled, and third-party packages stay external.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
  ssr: {
    noExternal: [/^@partledger\//],
  },
});
