/**
 * @module permissions/roles
 * Works out the caller's Role for one message.
 *
 *   owner      : sender's phone ∈ OWNER_NUMBERS, or LID ∈ OWNER_LIDS,
 *                or message is fromMe and SELF_IS_OWNER=true
 *   superadmin : phone ∈ db.global.superadmins (added by owner with .addsuper)
 *   admin      : WhatsApp admin of the CURRENT group (groups only)
 *   user       : everyone else
 * Docs: docs/02-PERMISSIONS.md#roles
 */
import type { BotEnv, GroupInfo, Role } from '../core/types.js';
import { isAdminIn } from '../core/groupCache.js';
import { pnJid, userPart } from '../core/jid.js';

export function resolveRole(
  env: BotEnv,
  p: { sender: string; senderPn: string | null; fromMe: boolean; group: GroupInfo | null },
): Role {
  const { config, db } = env;
  if (p.fromMe && config.selfIsOwner) return 'owner';
  if (p.senderPn && config.ownerNumbers.includes(p.senderPn)) return 'owner';
  if (config.ownerLids.includes(userPart(p.sender))) return 'owner';
  if (p.senderPn && db.global.data.superadmins.includes(p.senderPn)) return 'superadmin';
  if (isAdminIn(p.group, p.sender, p.senderPn ? pnJid(p.senderPn) : null)) return 'admin';
  return 'user';
}
