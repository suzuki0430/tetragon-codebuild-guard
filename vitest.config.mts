import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['lib/**/*.ts', 'scripts/**/*.mjs'],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: ['test/**/*.{test,spec}.{js,mjs,ts}'],
  },
});
