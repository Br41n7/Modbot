/**
 * @module services/moderation
 * Shared moderation building blocks used by BOTH commands and filters:
 *   resolveTargets()  who does this command apply to? (mentions / reply / numbers)
 *   canAct()          rank + safety rules (never kick the bot, owner, group creator, equal/higher rank)
 *   kickParticipant() remove a member (checks WhatsApp's per-user status code)
 *   addWarning()      increment warns, auto-kick at the group's limit
 *   enforce()         what a filter does on a violation: delete [+ warn | kick] + notice
 *   exempt()          who filters must leave alone
 * Docs: docs/05-MODERATION.md#services
 */
import type { Ctx, Role } from '../core/types.js';
import { ROLE_RANK } from '../core/types.js';
import { findParticipant } from '../core/groupCache.js';
import { at, norm, pnJid, userPart } from '../core/jid.js';
import { resolveRole } from '../permissions/roles.js';
import type { Action } from '../storage/db.js';
import { makeLog } from '../core/logger.js';

const log = makeLog('mod');

export interface Target {
  /** jid to use with group APIs (participant id in the group's addressing mode when known) */
  jid: string;
  pn: string | null;
  inGroup: boolean;
  role: Role;
  isBot: boolean;
  isCreator: boolean;
}

const NUM = /^@?\+?(\d{7,15})$/;

/** Collect target candidates: @mentions → replied-to author → numbers typed in args. */
export async function resolveTargets(ctx: Ctx, args: string[]): Promise<Target[]> {
  const { env } = ctx;
  const cands: string[] = [...ctx.mentioned];
  if (ctx.quoted) cands.push(ctx.quoted.sender);
  for (const a of args) {
    const m = a.match(NUM);
    if (m) cands.push(pnJid(m[1]!));
  }

  const seen = new Set<string>();
  const out: Target[] = [];
  const botKeys = [env.sock.user?.id, (env.sock.user as any)?.lid].filter(Boolean).map((j) => norm(j as string));

  for (const c of cands) {
    const p = findParticipant(ctx.group, c);
    const jid = p?.id ?? c;
    if (seen.has(norm(jid))) continue;
    seen.add(norm(jid));
    const pn = await env.identity.pnOf(jid, env.sock, [p?.phoneNumber, c]);
    const role = resolveRole(env, { sender: jid, senderPn: pn, fromMe: false, group: ctx.group });
    out.push({
      jid, pn, inGroup: !!p, role,
      isBot: botKeys.includes(norm(jid)) || (!!pn && pn === userPart(env.sock.user?.id)),
      isCreator: !!ctx.group?.superKeys.has(norm(jid)),
    });
  }
  return out;
}

/** The sender of the current message as a Target (used by filters). */
export async function senderTarget(ctx: Ctx): Promise<Target> {
  const p = findParticipant(ctx.group, ctx.sender);
  return {
    jid: p?.id ?? ctx.sender, pn: ctx.senderPn, inGroup: !!p, role: ctx.role,
    isBot: ctx.fromMe, isCreator: !!ctx.group?.superKeys.has(norm(ctx.sender)),
  };
}

/** null = allowed, otherwise a human-readable refusal. */
export function canAct(ctx: Ctx, t: Target): string | null {
  if (t.isBot) return "I can't do that to myself.";
  if (t.role === 'owner') return "That's the bot owner — untouchable.";
  if (ROLE_RANK[ctx.role] <= ROLE_RANK[t.role]) return "You can't act on someone with the same or higher rank.";
  if (t.isCreator && ctx.role !== 'owner') return "That's the group creator.";
  return null;
}

export async function kickParticipant(ctx: Ctx, t: Target): Promise<{ ok: boolean; error?: string }> {
  try {
    const res: any = await ctx.env.participantsUpdate(ctx.chat, [t.jid], 'remove');
    const status = Array.isArray(res) ? res[0]?.status : undefined;
    if (status && String(status) !== '200') return { ok: false, error: `WhatsApp refused (status ${status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'unknown error' };
  }
}

export async function addWarning(ctx: Ctx, t: Target, reason: string) {
  const g = ctx.env.db.group(ctx.chat);
  const key = t.pn ?? norm(t.jid);
  const rec = (g.warns[key] ??= { count: 0, reasons: [], updated: 0 });
  rec.count += 1;
  rec.reasons = [...rec.reasons, reason.slice(0, 100)].slice(-10);
  rec.updated = Date.now();
  const max = g.settings.maxWarns;
  let kicked = false;
  if (rec.count >= max) {
    const r = await kickParticipant(ctx, t);
    if (r.ok) { kicked = true; delete g.warns[key]; }
    else log.warn(`auto-kick failed in ${ctx.chat}: ${r.error}`);
  }
  ctx.env.db.saveGroups();
  return { count: rec.count, max, kicked };
}

const notified = new Map<string, number>();
export const resetNotices = () => notified.clear(); // tests
/** Tell the group (at most once / 30 min) that a protection can't work because the bot isn't admin. */
export async function noteBotNotAdmin(ctx: Ctx, what: string) {
  const last = notified.get(ctx.chat) ?? 0;
  if (Date.now() - last < 30 * 60_000) return;
  notified.set(ctx.chat, Date.now());
  await ctx.send(`⚠️ ${what} is enabled but I'm not a group admin, so I can't enforce it. Please make me admin.`);
}

/** Filters must not touch: the bot itself, superadmins/owner, and (optionally) group admins. */
export function exempt(ctx: Ctx): boolean {
  if (ctx.fromMe) return true;
  if (ROLE_RANK[ctx.role] >= ROLE_RANK.superadmin) return true;
  if (ctx.role === 'admin' && ctx.env.db.settings(ctx.chat).exemptAdmins) return true;
  return false;
}

/** Standard reaction to a filter violation. Requires the bot to be admin to delete. */
export async function enforce(ctx: Ctx, action: Action, reason: string, filterName: string) {
  if (!ctx.group?.botIsAdmin) return noteBotNotAdmin(ctx, filterName);
  await ctx.deleteMsg();
  if (action === 'delete') return;

  const t = await senderTarget(ctx);
  if (action === 'warn') {
    const r = await addWarning(ctx, t, reason);
    await ctx.send(
      `⚠️ ${at(t.jid)} — ${reason}\nWarning ${r.count}/${r.max}${r.kicked ? ' — limit reached, removed from the group.' : ''}`,
      [t.jid],
    );
  } else {
    const r = await kickParticipant(ctx, t);
    await ctx.send(r.ok ? `🚫 ${at(t.jid)} removed — ${reason}` : `⚠️ Couldn't remove ${at(t.jid)}: ${r.error}`, [t.jid]);
  }
}
