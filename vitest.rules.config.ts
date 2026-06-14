import { defineConfig } from 'vitest/config';

/**
 * Standalone config for Firestore security-rule tests (tests/rules/**).
 *
 * These talk to the real Firestore emulator via @firebase/rules-unit-testing,
 * so unlike the main vitest config this one MUST NOT alias `firebase/firestore`
 * to the in-memory mock, runs in a node environment, and skips the jsdom setup
 * file. Launched through `npm run test:rules`, which wraps it in
 * `firebase emulators:exec --only firestore`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/rules/**/*.{test,spec}.ts'],
    exclude: ['node_modules', '.next', 'coverage', 'dist'],
    // Rule tests share one emulator instance; run serially to avoid
    // clearFirestore() in one file wiping another file's seeded data.
    fileParallelism: false,
  },
});
