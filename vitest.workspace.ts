import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const sharedAlias = {
  '@swaft/shared': resolve(process.cwd(), 'packages/shared/src/index.ts'),
};

export default defineWorkspace([
  {
    resolve: { alias: sharedAlias },
    test: {
      name: 'node',
      environment: 'node',
      include: [
        'packages/**/src/**/*.test.ts',
        'apps/desktop/src/main/**/*.test.ts',
        'apps/desktop/src/preload/**/*.test.ts',
      ],
    },
  },
  {
    plugins: [react()],
    resolve: { alias: sharedAlias },
    test: {
      name: 'dom',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
    },
  },
]);
