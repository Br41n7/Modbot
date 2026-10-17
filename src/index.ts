/**
 * Entry point.  npm start  →  tsx src/index.ts
 * Everything else is in src/core/connection.ts (boot) and src/modules/* (features).
 * Docs: docs/00-ARCHITECTURE.md
 */
import { startBot } from './core/connection.js';
import { log } from './core/logger.js';

startBot().catch((err) => {
  log.error('Fatal startup error:', err);
  process.exit(1);
});
