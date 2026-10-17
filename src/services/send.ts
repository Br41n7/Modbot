/**
 * @module services/send
 * Send from outside a message context (e.g. welcome messages from group events).
 * Always via the anti-ban wrapped socket, always passes an options object, records the id so the
 * echo is ignored by the dispatcher.
 */
import type { BotEnv } from '../core/types.js';
import { makeLog } from '../core/logger.js';

const log = makeLog('send');

export async function sendSafe(env: BotEnv, chat: string, text: string, mentions: string[] = []) {
  try {
    const res = await env.safe.sendMessage(chat, mentions.length ? { text, mentions } : { text }, {});
    env.sent.add(res?.key?.id);
  } catch (err) {
    log.warn(`send to ${chat} failed: ${(err as Error)?.message}`);
  }
}
