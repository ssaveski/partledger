import { defineConfig } from 'vite';

// The API ships as one Node bundle; workspace libraries are TypeScript sources, so
// they are bundled, and third-party packages stay external. The upload parse worker runs
// as its own process (src/uploads/parse-worker.ts), so its entry is built beside main.js.
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'src/main.ts',
        'parse-worker.process': 'src/uploads/parse-worker.process.ts',
      },
      output: { entryFileNames: '[name].js' },
    },
  },
  ssr: {
    noExternal: [/^@partledger\//],
  },
});
