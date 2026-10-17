/**
 * @module core/identity
 * Turns ANY jid (PN or LID) into a phone-number string, because owners/superadmins are
 * configured by phone number but WhatsApp increasingly shows people as LIDs.
 *
 * Resolution order for a LID:
 *   1. our persisted map (db.global.lidMap)          — instant
 *   2. hints (message key participantAlt, group participant.phoneNumber) — free
 *   3. Baileys signalRepository.lidMapping.getPNForLID — async lookup
 * Every successful resolution is learned + persisted.
 * Docs: docs/02-PERMISSIONS.md#identity
 */
import type { WASocket } from 'baileys';
import type { Db } from '../storage/db.js';
import { digitsOnly, isLid, isPn, norm, userPart } from './jid.js';

export class Identity {
  constructor(private db: Db) {}

  learn(lid?: string | null, pn?: string | null) {
    if (!lid || !pn || !isLid(lid) || !isPn(pn)) return;
    const l = userPart(lid), p = userPart(pn);
    if (this.db.global.data.lidMap[l] !== p) {
      this.db.global.data.lidMap[l] = p;
      this.db.saveGlobal();
    }
  }

  /** phone digits for a jid, or null if it can't be resolved */
  async pnOf(jid: string | undefined | null, sock?: WASocket, hints: Array<string | undefined | null> = []): Promise<string | null> {
    if (!jid) return null;
    if (isPn(jid)) return userPart(jid);
    if (!isLid(jid)) return digitsOnly(userPart(jid)) || null;

    const known = this.db.global.data.lidMap[userPart(jid)];
    if (known) return known;

    for (const h of hints) {
      if (h && isPn(h)) { this.learn(jid, h); return userPart(h); }
    }
    try {
      const pn = await (sock as any)?.signalRepository?.lidMapping?.getPNForLID?.(norm(jid));
      if (pn && isPn(pn)) { this.learn(jid, pn); return userPart(pn); }
    } catch { /* lookup is best-effort */ }
    return null;
  }

  /** stable key for storing per-user data (warns, bans): phone digits if known, else normalized jid */
  async keyOf(jid: string, sock?: WASocket, hints: Array<string | undefined | null> = []): Promise<string> {
    return (await this.pnOf(jid, sock, hints)) ?? norm(jid);
  }
}
