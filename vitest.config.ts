import { defineConfig } from 'vitest/config';

// Vitest >= 3.2 usa `test.projects` (el archivo vitest.workspace está deprecado).
export default defineConfig({
  test: {
    projects: ['packages/*', 'services/*', 'infra', 'apps/*'],
    coverage: { provider: 'v8', include: ['packages/core/src/**'] },
  },
});
