/**
 * @module core/antibanSetup
 * The ONE place where baileys-antiban is attached to a raw Baileys socket.
 *
 * Returns:
 *   safe               wrapped socket → use for every chat message the bot sends
 *   participantsUpdate add/remove (rate-guarded by the library) vs promote/demote (guard bypassed)
 *
 * Why the bypass: baileys-antiban 4.10.0 maps ANY action that is not "add"/"remove" to the "add" bucket
 * (3 per 10 min), so promote/demote would be throttled and would also eat the add budget.
 * `tests/antiban.test.ts` has a canary test that fails if a future library version fixes this.
 * Docs: docs/07-ANTIBAN-INTEGRATION.md
 */
import path from 'node:path';
import type { WASocket } from 'baileys';
import { wrapSocket } from 'baileys-antiban';
import { config } from '../config.js';
import type { BotEnv } from './types.js';

export interface AntibanOverrides {
  persist?: string | undefined;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export function wireAntiban(sock: WASocket, overrides: AntibanOverrides = {}) {
  // MUST be captured BEFORE wrapSocket(): the wrapper replaces sock.groupParticipantsUpdate in place.
  const rawParticipantsUpdate = sock.groupParticipantsUpdate.bind(sock);

  // baileys-antiban's WASocket type is intentionally loose, so we cast in and out at this one boundary.
  const safe = wrapSocket(
    sock as any,
    {
      preset: config.antiban.preset,
      warmupDays: config.antiban.warmupDays,
      persist: 'persist' in overrides ? overrides.persist : path.join(config.dataDir, 'antiban-state.json'),
      groupProfiles: true,
      logging: false,
      ...(overrides.minDelayMs !== undefined ? { minDelayMs: overrides.minDelayMs } : {}),
      ...(overrides.maxDelayMs !== undefined ? { maxDelayMs: overrides.maxDelayMs } : {}),
    },
    undefined,
    {
      legitimacySignals: config.antiban.legitimacySignals ? {} : false,
      groupOpGuard: {
        limits: {
          add: { max: config.groupOps.addPer10Min, windowMs: 600_000 },
          remove: { max: config.groupOps.removePer10Min, windowMs: 600_000 },
        },
      },
    },
  ) as unknown as WASocket;

  const participantsUpdate: BotEnv['participantsUpdate'] = (jid, ids, action) =>
    action === 'add' || action === 'remove'
      ? sock.groupParticipantsUpdate(jid, ids, action) // guarded by baileys-antiban
      : rawParticipantsUpdate(jid, ids, action);       // promote / demote: not guarded

  return { safe, participantsUpdate };
}
