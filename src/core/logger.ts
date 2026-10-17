/**
 * @module core/logger
 * Two loggers:
 *  - `makeLog(scope)` : tiny timestamped console logger for OUR code.
 *  - `baileysLog`     : pino instance handed to Baileys (silent unless LOG_LEVEL=debug).
 * Docs: docs/01-CORE.md#logger
 */
import pino from 'pino';
import { config } from '../config.js';

const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;
const enabled = (lvl: (typeof LEVELS)[number]) =>
  config.logLevel !== 'silent' && LEVELS.indexOf(config.logLevel) >= LEVELS.indexOf(lvl);

const out = (lvl: string, scope: string, args: unknown[]) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} ${lvl.toUpperCase().padEnd(5)} [${scope}]`, ...args);
};

export const makeLog = (scope: string) => ({
  error: (...a: unknown[]) => enabled('error') && out('error', scope, a),
  warn: (...a: unknown[]) => enabled('warn') && out('warn', scope, a),
  info: (...a: unknown[]) => enabled('info') && out('info', scope, a),
  debug: (...a: unknown[]) => enabled('debug') && out('debug', scope, a),
});

export const log = makeLog('bot');

export const baileysLog = pino({ level: config.logLevel === 'debug' ? 'warn' : 'silent' });
