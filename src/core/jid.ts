/**
 * @module core/jid
 * Pure JID helpers. WhatsApp has TWO identity forms for one person:
 *   PN  : 2348012345678@s.whatsapp.net   (phone number)
 *   LID : 123456789012345@lid            (privacy "linked id")
 * Devices add a suffix (":12") — `norm()` strips it so comparisons work.
 * Docs: docs/02-PERMISSIONS.md#identity
 */
import { jidDecode } from 'baileys';

/** "123:5@s.whatsapp.net" -> "123@s.whatsapp.net". Returns '' for empty input. */
export function norm(jid?: string | null): string {
  if (!jid) return '';
  const d = jidDecode(jid);
  return d ? `${d.user}@${d.server}` : jid;
}

/** "123:5@s.whatsapp.net" -> "123" */
export function userPart(jid?: string | null): string {
  if (!jid) return '';
  return jidDecode(jid)?.user ?? jid.split('@')[0]!.split(':')[0]!;
}

export const isLid = (jid?: string | null) => norm(jid).endsWith('@lid');
export const isPn = (jid?: string | null) => norm(jid).endsWith('@s.whatsapp.net');
export const isGroupJid = (jid?: string | null) => !!jid && jid.endsWith('@g.us');
export const digitsOnly = (s: string) => s.replace(/\D/g, '');
export const pnJid = (digits: string) => `${digitsOnly(digits)}@s.whatsapp.net`;

/** Display helper for mentions: "@2348012345678" */
export const at = (jid: string) => `@${userPart(jid)}`;
