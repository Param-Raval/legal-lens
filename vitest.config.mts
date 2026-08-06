import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig's "@/*" → "./src/*" so tests import production modules
      // by their real specifiers.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Server-side logic tests — no DOM emulation needed. Component tests would
    // add jsdom in their own environment via a per-file docblock.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // The pdf-pages integration test renders a real PDF through pdfjs + native
    // canvas; give it headroom beyond the 5s default.
    testTimeout: 30_000,
  },
});
