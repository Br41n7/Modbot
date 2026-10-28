/**
 * Test harness: a fake WhatsApp socket + real Db/Registry/Policy/Dispatcher.
 * The fake group uses LID addressing (the hard case) with these people:
 *   bot (admin) • alice (admin) • bob (member) • carl (group creator) • owen (BOT OWNER, member) • sam (BOT SUPERADMIN, member)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WAMessage } from 'baileys';
import { config } from '../src/config.js';
import { createEnvBase } from '../src/core/connection.js';
import { Dispatcher } from '../src/core/dispatcher.js';
import type { BotEnv } from '../src/core/types.js';
import { resetNotices } from '../src/services/moderation.js';
import { resetSpamState } from '../src/modules/protection/filters.js';

export const GROUP = '120363000000000001@g.us';
export const BOT_PN = '2349000000000';
export const P = {
  alice: { lid: '111111111111111@lid', pn: '2348011111111' },
  bob: { lid: '222222222222222@lid', pn: '2348022222222' },
  carl: { lid: '333333333333333@lid', pn: '2348033333333' },
  owen: { lid: '444444444444444@lid', pn: '2348044444444' },
  sam: { lid: '555555555555555@lid', pn: '2348055555555' },
  zed: { lid: '666666666666666@lid', pn: '2348066666666' }, // extra member
};
export const BOT_LID = '999111222333444@lid';

export const pnJ = (n: string) => `${n}@s.whatsapp.net`;

export interface Call { m: string; args: any[] }

export function makeGroupMeta(botAdmin = true) {
  const part = (id: string, pn: string, admin: 'admin' | 'superadmin' | null) => ({ id, lid: id, phoneNumber: pnJ(pn), admin });
  return {
    id: GROUP, subject: 'Test Group', owner: P.carl.lid, addressingMode: 'lid', announce: false, restrict: false, desc: '',
    participants: [
      part(BOT_LID, BOT_PN, botAdmin ? 'admin' : null),
      part(P.alice.lid, P.alice.pn, 'admin'),
      part(P.bob.lid, P.bob.pn, null),
      part(P.carl.lid, P.carl.pn, 'superadmin'),
      part(P.owen.lid, P.owen.pn, null),
      part(P.sam.lid, P.sam.pn, null),
      part(P.zed.lid, P.zed.pn, null),
    ],
  } as any;
}

export async function makeEnv(opts: { botAdmin?: boolean } = {}) {
  resetNotices(); resetSpamState();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wamod-'));
  Object.assign(config, {
    dataDir: dir, authDir: path.join(dir, 'auth'), logLevel: 'silent', cooldownMs: 0, prefix: '.',
    ownerNumbers: [P.owen.pn], ownerLids: [], selfIsOwner: true, maxMessageAgeSec: 60,
  });
  const base = createEnvBase();
  base.db.global.data.superadmins.push(P.sam.pn);

  const calls: Call[] = [];
  const rec = (m: string, ret?: any) => async (...args: any[]) => { calls.push({ m, args }); return typeof ret === 'function' ? ret(...args) : ret; };
  let n = 0;
  const meta = makeGroupMeta(opts.botAdmin ?? true);
  const sock: any = {
    user: { id: `${BOT_PN}:7@s.whatsapp.net`, lid: `${BOT_LID.split('@')[0]}:7@lid` },
    sendMessage: async (jid: string, content: any, options: any) => { calls.push({ m: 'sendMessage', args: [jid, content, options] }); return { key: { id: `BOT${++n}` } }; },
    groupMetadata: async () => meta,
    groupSettingUpdate: rec('groupSettingUpdate'),
    groupUpdateSubject: rec('groupUpdateSubject'),
    groupUpdateDescription: rec('groupUpdateDescription'),
    groupInviteCode: rec('groupInviteCode', 'ABCDEF1234567'),
    groupRevokeInvite: rec('groupRevokeInvite', 'ZZZZZZ9999999'),
    groupFetchAllParticipating: async () => ({ [GROUP]: meta }),
    groupLeave: rec('groupLeave'),
  };
  const participantsUpdate = async (jid: string, ids: string[], action: string) => {
    calls.push({ m: 'participantsUpdate', args: [jid, ids, action] });
    return ids.map((id) => ({ status: '200', jid: id }));
  };
  const env = { ...base, sock, safe: sock, participantsUpdate } as unknown as BotEnv;
  const dispatcher = new Dispatcher(env);

  const sent = () => calls.filter((c) => c.m === 'sendMessage' && !c.args[1].delete).map((c) => c.args[1]);
  const texts = () => sent().map((c) => c.text ?? '').filter(Boolean);
  const deletes = () => calls.filter((c) => c.m === 'sendMessage' && c.args[1].delete).map((c) => c.args[1].delete);
  const of = (m: string) => calls.filter((c) => c.m === m);
  const reset = () => { calls.length = 0; };

  return { env, dispatcher, calls, sent, texts, deletes, of, reset, dir };
}

let idc = 0;
export function msg(o: {
  from: { lid: string; pn: string } | 'bot'; text?: string; sticker?: boolean; image?: boolean; chat?: string;
  mentions?: string[]; quoteFrom?: string; ageSec?: number; fromMe?: boolean; id?: string;
}): WAMessage {
  const chat = o.chat ?? GROUP;
  const id = o.id ?? `MSG${++idc}`;
  const ci: any = {};
  if (o.mentions) ci.mentionedJid = o.mentions;
  if (o.quoteFrom) { ci.stanzaId = 'QUOTED1'; ci.participant = o.quoteFrom; ci.quotedMessage = { conversation: 'quoted text' }; }
  let message: any;
  if (o.sticker) message = { stickerMessage: { mimetype: 'image/webp' } };
  else if (o.image) message = { imageMessage: { mimetype: 'image/jpeg', caption: o.text } };
  else if (o.mentions || o.quoteFrom) message = { extendedTextMessage: { text: o.text ?? '', contextInfo: ci } };
  else message = { conversation: o.text ?? '' };

  const fromMe = o.fromMe ?? o.from === 'bot';
  const key: any = { remoteJid: chat, fromMe, id };
  if (chat.endsWith('@g.us') && o.from !== 'bot') {
    key.participant = o.from.lid; key.participantAlt = pnJ(o.from.pn);
  }
  if (!chat.endsWith('@g.us') && o.from !== 'bot') { key.remoteJid = pnJ(o.from.pn); }
  return { key, message, pushName: 'Tester', messageTimestamp: Math.floor(Date.now() / 1000) - (o.ageSec ?? 0) } as WAMessage;
}
