/**
 * @module config
 * Loads .env once and exposes a plain mutable `config` object.
 * Mutable on purpose: tests override fields directly (config.ownerNumbers = [...]).
 * Docs: docs/01-CORE.md#config
 */
import 'dotenv/config';
import path from 'node:path';

const digits = (s: string) => s.replace(/\D/g, '');
const list = (v?: string) => (v ?? '').split(',').map(digits).filter(Boolean);
const bool = (v: string | undefined, d: boolean) =>
  v == null || v.trim() === '' ? d : /^(1|true|yes|on)$/i.test(v.trim());
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v != null && v.trim() !== '' && Number.isFinite(n) ? n : d;
};

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  botName: process.env.BOT_NAME || 'ModBot',
  prefix: process.env.PREFIX || '.',
  ownerNumbers: list(process.env.OWNER_NUMBERS),
  ownerLids: list(process.env.OWNER_LIDS),
  selfIsOwner: bool(process.env.SELF_IS_OWNER, true),
  pairingNumber: digits(process.env.PAIRING_NUMBER || ''),
  dataDir,
  authDir: path.resolve(process.env.AUTH_DIR || path.join(dataDir, 'auth')),
  cooldownMs: num(process.env.COMMAND_COOLDOWN_MS, 2000),
  maxMessageAgeSec: num(process.env.MAX_MESSAGE_AGE_SEC, 60),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'silent' | 'error' | 'warn' | 'info' | 'debug',
  /** group-operation ceilings enforced by baileys-antiban's GroupOperationGuard (per 10 minutes) */
  groupOps: {
    addPer10Min: num(process.env.MAX_ADDS_PER_10MIN, 3),
    removePer10Min: num(process.env.MAX_KICKS_PER_10MIN, 10),
  },
  antiban: {
    preset: (process.env.ANTIBAN_PRESET || 'moderate') as 'conservative' | 'moderate' | 'aggressive' | 'high-volume',
    warmupDays: num(process.env.ANTIBAN_WARMUP_DAYS, 0),
    legitimacySignals: bool(process.env.LEGIT_SIGNALS, false),
  },
};

export type Config = typeof config;
