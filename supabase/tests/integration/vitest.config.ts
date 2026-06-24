import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Auth integration tests hit a real Supabase instance — allow enough time
    // for network round-trips and TOTP window waits.
    testTimeout: 120_000,
    hookTimeout: 30_000,
    // Run serially: tests share Supabase state (users, factors).
    // singleFork was removed in Vitest 4; maxWorkers: 1 achieves the same result.
    pool: 'forks',
    maxWorkers: 1,
    // Pick up env from the environment or fall back to local dev defaults.
    // Use || (not ??) so that empty strings passed by CI are also replaced.
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    },
  },
});
