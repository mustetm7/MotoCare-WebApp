import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/tests/accountDeletion.test.ts',
      'src/tests/**/*.test.{ts,tsx}',
      'tests/adminFooterLink.test.tsx',
      'tests/preBetaSecurityAndCleanup.test.tsx',
      'tests/cloudSyncAndMigration.test.tsx',
      'tests/**/*.spec.{ts,tsx}',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
});
