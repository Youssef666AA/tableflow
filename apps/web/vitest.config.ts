import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest keeps its own config so the app's Vite config stays free of test
 * concerns. JSX is transformed by esbuild using tsconfig's `jsx: react-jsx`,
 * so the React plugin is not needed here.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
