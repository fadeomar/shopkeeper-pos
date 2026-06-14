import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const firestoreMockPath = fileURLToPath(new URL('./tests/mocks/firebase-firestore.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      'firebase/firestore': firestoreMockPath,
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // tests/rules/** run against the Firestore emulator with the REAL SDK; they
    // have their own runner (vitest.rules.config.ts + `npm run test:rules`) and
    // must be excluded here, where `firebase/firestore` is mocked.
    exclude: ['node_modules', '.next', 'coverage', 'dist', 'tests/rules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['lib/**/*.{ts,tsx}', 'features/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/node_modules/**',
      ],
    },
  },
});
