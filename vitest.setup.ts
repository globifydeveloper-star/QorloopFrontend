import { beforeEach, vi } from 'vitest';

/**
 * Every test starts with every VITE_REAL_* feature flag OFF, whatever a developer's .env.local says, so the suite
 * gives the same result on every machine. A test that needs a flag on sets it itself with vi.stubEnv(flag, 'true').
 *
 * The list names every flag in src/lib/features.ts (src/lib/__tests__/flags.test.ts fails if one is missing); any other
 * VITE_REAL_* variable present in the environment is switched off too.
 */
export const REAL_FLAGS = ['VITE_REAL_UPLOADS', 'VITE_REAL_CATALOGUE', 'VITE_REAL_RECON', 'VITE_REAL_PRICING', 'VITE_REAL_FILES', 'VITE_REAL_SETTINGS'] as const;

const allFlags = () => [...new Set([...REAL_FLAGS, ...Object.keys(import.meta.env).filter(k => k.startsWith('VITE_REAL_'))])];
const allOff = () => { for (const flag of allFlags()) vi.stubEnv(flag, ''); };

// Before the test file's own imports run: some modules read a flag at load time (CONNECTED_VIEWS in src/routes/paths.ts).
allOff();
// Before each test's own beforeEach, so a file can still turn a flag on; vi.unstubAllEnvs() in a test's afterEach
// restores the .env.local values, which this puts back to off for the next test.
beforeEach(allOff);
