/**
 * @module core/context
 * Builds the `Ctx` object every command/filter receives from a raw Baileys message:
 *   chat/sender/role resolution, text + type extraction, mentions, quoted-message info,
 *   and the reply/send/react/deleteMsg helpers.
 *
 * Sending rules (see docs/07-ANTIBAN-INTEGRATION.md):
 *   - chat messages  -> env.safe (anti-ban wrapped; ALWAYS pass an options object, library quirk)
 *   - delete/kick/etc-> env.sock (raw; moderation must be instant)
 * Docs: docs/01-CORE.md#context
 */
import { getContentType, normalizeMessageContent } from 'baileys';
import type { WAMessage, WAMessageKey } from 'baileys';
import type { BotEnv, Ctx, QuotedInfo } from './types.js';
import { isGroupJid, norm, userPart } from './jid.js';
import { resolveRole } from '../permissions/roles.js';
import { makeLog } from './logger.js';

const log = makeLog('ctx');

export function parseCommand(text: string, prefix: string): { name: string; args: string[]; raw: string } | null {
  const t = text.trim();
  if (!prefix || !t.startsWith(prefix)) return null;
  const body = t.slice(prefix.length);
  if (!body || /^\s/.test(body)) return null; // ". help" is not a command
  const m = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const raw = m[2]!.trim();
  return { name: m[1]!.toLowerCase(), args: raw ? raw.split(/\s+/) : [], raw };
}

export function contentOf(msg: WAMessage): { content: any; type: string } {
  const content: any = normalizeMessageContent(msg.message) ?? {};
  return { content, type: (getContentType(content) as string) ?? 'unknown' };
}

export function textOf(content: any): string {
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedButtonId ??
    content.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content.templateButtonReplyMessage?.selectedId ??
    ''
  );
}

export async function buildCtx(env: BotEnv, msg: WAMessage): Promise<Ctx | null> {
  const chat = msg.key.remoteJid;
  if (!chat || chat === 'status@broadcast' || chat.endsWith('@newsletter') || chat.endsWith('@broadcast')) return null;

  const { sock, safe, config } = env;
  const isGroup = isGroupJid(chat);
  const fromMe = !!msg.key.fromMe;
  const ownJid = norm(sock.user?.id);
  const k: any = msg.key;

  const sender = fromMe ? ownJid : isGroup ? (msg.key.participant as string | undefined) ?? '' : chat;
  if (!sender) return null;

  const senderPn = fromMe
    ? userPart(ownJid)
    : await env.identity.pnOf(sender, sock, [k.participantAlt, k.remoteJidAlt]);

  const group = isGroup ? await env.groups.get(sock, chat) : null;
  const role = resolveRole(env, { sender, senderPn, fromMe, group });

  const { content, type } = contentOf(msg);
  const text = textOf(content);
  const ci: any = content[type]?.contextInfo;
  const mentioned: string[] = (ci?.mentionedJid as string[] | undefined) ?? [];

  let quoted: QuotedInfo | null = null;
  if (ci?.stanzaId && ci?.participant) {
    const qp = ci.participant as string;
    const ownLid = norm((sock.user as any)?.lid);
    const key: WAMessageKey = {
      remoteJid: chat,
      id: ci.stanzaId,
      participant: qp,
      fromMe: norm(qp) === ownJid || (!!ownLid && norm(qp) === ownLid),
    };
    quoted = { key, sender: qp, message: ci.quotedMessage };
  }

  const out = async (text: string, mentions: string[] | undefined, quote: boolean) => {
    try {
      const res = await safe.sendMessage(
        chat,
        mentions?.length ? { text, mentions } : { text },
        quote ? { quoted: msg } : {}, // NEVER omit: baileys-antiban crashes on undefined options
      );
      env.sent.add(res?.key?.id);
    } catch (err) {
      log.warn(`send to ${chat} failed: ${(err as Error)?.message}`);
    }
  };

  return {
    env, msg, chat, isGroup, fromMe, sender, senderPn,
    senderName: msg.pushName ?? '',
    role, text, type, mentioned, quoted, group,
    prefix: env.db.global.data.prefix ?? config.prefix,
    reply: (t, m) => out(t, m, true),
    send: (t, m) => out(t, m, false),
    react: async (emoji) => {
      try { await safe.sendMessage(chat, { react: { text: emoji, key: msg.key } }, {}); } catch { /* best effort */ }
    },
    deleteMsg: async (key) => {
      try { await sock.sendMessage(chat, { delete: key ?? msg.key }); return true; }
      catch (err) { log.warn(`delete failed in ${chat}: ${(err as Error)?.message}`); return false; }
    },
  };
}
