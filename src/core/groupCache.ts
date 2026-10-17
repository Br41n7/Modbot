/**
 * @module core/groupCache
 * Caches group metadata (5 min TTL) and precomputes admin lookup sets.
 *  - Fewer metadata queries = lower ban risk (also fed to Baileys via cachedGroupMetadata).
 *  - Invalidated by dispatcher on group-participants.update / groups.update.
 *  - On fetch failure (rate limit etc.) returns the stale copy instead of failing.
 * Docs: docs/01-CORE.md#group-cache
 */
import type { GroupMetadata, GroupParticipant, WASocket } from 'baileys';
import type { GroupInfo } from './types.js';
import { norm } from './jid.js';
import { makeLog } from './logger.js';

const log = makeLog('groups');

export class GroupCache {
  private map = new Map<string, GroupInfo>();
  /** called with (lid, pn) whenever a participant exposes both — feeds Identity */
  onLearn?: (lid: string, pn: string) => void;

  constructor(private ttlMs = 5 * 60_000) {}

  /** metadata only (for Baileys cachedGroupMetadata) */
  peek(jid: string): GroupMetadata | undefined { return this.map.get(jid)?.meta; }
  invalidate(jid: string) { this.map.delete(jid); }
  clear() { this.map.clear(); }
  all(): GroupInfo[] { return [...this.map.values()]; }

  async get(sock: WASocket, jid: string, force = false): Promise<GroupInfo | null> {
    const cached = this.map.get(jid);
    if (cached && !force && Date.now() - cached.fetchedAt < this.ttlMs) return cached;
    try {
      const meta = await sock.groupMetadata(jid);
      const info = this.build(sock, meta);
      this.map.set(jid, info);
      return info;
    } catch (err) {
      log.warn(`groupMetadata(${jid}) failed${cached ? ' — using stale copy' : ''}:`, (err as Error)?.message);
      return cached ?? null;
    }
  }

  /** exposed for tests */
  build(sock: Pick<WASocket, 'user'>, meta: GroupMetadata): GroupInfo {
    const adminKeys = new Set<string>();
    const superKeys = new Set<string>();
    const byKey = new Map<string, GroupParticipant>();

    for (const p of meta.participants) {
      const keys = [p.id, (p as any).lid, p.phoneNumber].filter(Boolean).map((j) => norm(j as string));
      for (const k of keys) byKey.set(k, p);
      const isSuper = p.admin === 'superadmin' || p.isSuperAdmin === true;
      const isAdmin = isSuper || p.admin === 'admin' || p.isAdmin === true;
      if (isAdmin) keys.forEach((k) => adminKeys.add(k));
      if (isSuper) keys.forEach((k) => superKeys.add(k));
      const lid = [p.id, (p as any).lid].find((j) => j && String(j).endsWith('@lid'));
      const pn = [p.id, p.phoneNumber].find((j) => j && String(j).endsWith('@s.whatsapp.net'));
      if (lid && pn) this.onLearn?.(lid as string, pn as string);
    }

    const botKeys = [sock.user?.id, (sock.user as any)?.lid].filter(Boolean).map((j) => norm(j as string));
    const botIsAdmin = botKeys.some((k) => adminKeys.has(k));
    return { meta, adminKeys, superKeys, byKey, botIsAdmin, fetchedAt: Date.now() };
  }
}

/** true if any of the given jids is an admin in this group */
export const isAdminIn = (g: GroupInfo | null, ...jids: Array<string | undefined | null>) =>
  !!g && jids.some((j) => j && g.adminKeys.has(norm(j)));

/** find the participant record for a jid in any form */
export const findParticipant = (g: GroupInfo | null, jid?: string | null) =>
  g && jid ? g.byKey.get(norm(jid)) : undefined;
