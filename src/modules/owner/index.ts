/**
 * @module modules/owner
 * Owner / superuser control panel. Default role `owner` (the ONLY WhatsApp number(s) in OWNER_NUMBERS).
 * Commands marked 🔒 are ownerLocked: their role can never be changed at runtime.
 *
 *  People     🔒addsuper  🔒delsuper  supers  ban  unban  banlist
 *  Policy     🔒setrole  🔒resetrole  perms  🔒superfeatures  🔒userfeatures
 *  Bot        🔒setprefix  mode  health  groups  leave  🔒shutdown
 *
 * Policy model recap (docs/02-PERMISSIONS.md): tiers are cumulative user < admin < superadmin < owner.
 * `.superfeatures add X` → superadmins may run X.   `.userfeatures add X` → everyone may run X.
 * Docs: docs/06-OWNER-ADMIN.md
 */
import type { BotModule, Command, Ctx, Role } from '../../core/types.js';
import { isRole, ROLES } from '../../core/types.js';
import { at, userPart } from '../../core/jid.js';
import { resolveTargets } from '../../services/moderation.js';
import { formatUptime } from '../../services/util.js';
import { makeLog } from '../../core/logger.js';

const log = makeLog('owner');
const cmd = (c: Omit<Command, 'defaultRole'> & { defaultRole?: Command['defaultRole'] }): Command => ({ defaultRole: 'owner', ...c });
const LOCK = { ownerLocked: true } as const;

/** "kick" (command/alias) or "antilink" (feature) → feature key, or null */
function featureFrom(ctx: Ctx, name?: string): string | null {
  if (!name) return null;
  const c = ctx.env.registry.find(name.replace(ctx.prefix, ''));
  if (c) return ctx.env.registry.featureOf(c);
  return ctx.env.policy.exists(name) ? name : null;
}

/** phone digits from mention / reply / typed number; tells the caller if it could not be resolved */
async function personArg(ctx: Ctx, args: string[]): Promise<{ pn: string; jid: string } | null> {
  const [t] = await resolveTargets(ctx, args);
  if (!t) { await ctx.reply('Mention someone, reply to their message, or type their number (country code first).'); return null; }
  if (!t.pn) { await ctx.reply(`Couldn't resolve ${at(t.jid)}'s phone number (privacy ID). Type the number instead (country code first, digits only).`); return null; }
  return { pn: t.pn, jid: t.jid };
}

// ───────── people ─────────
const addsuper = cmd({
  name: 'addsuper', ...LOCK, description: 'Make someone a bot superadmin.', usage: 'addsuper @user | addsuper 2348012345678',
  async run(ctx, args) {
    const p = await personArg(ctx, args); if (!p) return;
    const g = ctx.env.db.global.data;
    if (ctx.env.config.ownerNumbers.includes(p.pn)) return ctx.reply('That number is already an owner.');
    if (g.superadmins.includes(p.pn)) return ctx.reply('Already a superadmin.');
    g.superadmins.push(p.pn); ctx.env.db.saveGlobal();
    await ctx.reply(`⭐ +${p.pn} is now a superadmin. Run ${ctx.prefix}perms to see what superadmins can do.`);
  },
});

const delsuper = cmd({
  name: 'delsuper', ...LOCK, description: 'Remove a superadmin.', usage: 'delsuper @user | delsuper 2348012345678',
  async run(ctx, args) {
    const p = await personArg(ctx, args); if (!p) return;
    const g = ctx.env.db.global.data;
    if (!g.superadmins.includes(p.pn)) return ctx.reply('That number is not a superadmin.');
    g.superadmins = g.superadmins.filter((n) => n !== p.pn); ctx.env.db.saveGlobal();
    await ctx.reply(`✅ +${p.pn} is no longer a superadmin.`);
  },
});

const supers = cmd({
  name: 'supers', description: 'List superadmins.',
  async run(ctx) {
    const l = ctx.env.db.global.data.superadmins;
    await ctx.reply(l.length ? `⭐ *Superadmins*\n${l.map((n) => `• +${n}`).join('\n')}` : 'No superadmins yet. Use .addsuper');
  },
});

const ban = cmd({
  name: 'ban', description: 'Globally ban someone from using the bot (it will ignore them everywhere).', usage: 'ban @user [reason]',
  async run(ctx, args, raw) {
    const [t] = await resolveTargets(ctx, args);
    if (!t) return ctx.reply(`Usage: ${ctx.prefix}ban @user [reason]`);
    const key = t.pn ?? userPart(t.jid);
    if (t.role === 'owner' || t.role === 'superadmin') return ctx.reply("You can't ban the owner or a superadmin.");
    ctx.env.db.global.data.banned[key] = { reason: raw.replace(/@?\+?\d{7,15}/g, '').trim() || 'no reason', by: ctx.senderPn ?? 'owner', at: Date.now() };
    ctx.env.db.saveGlobal();
    await ctx.reply(`🚫 ${key} banned from using the bot.`);
  },
});

const unban = cmd({
  name: 'unban', description: 'Lift a bot ban.', usage: 'unban @user | unban 2348012345678',
  async run(ctx, args) {
    const [t] = await resolveTargets(ctx, args);
    if (!t) return ctx.reply(`Usage: ${ctx.prefix}unban @user`);
    const key = t.pn ?? userPart(t.jid);
    if (!ctx.env.db.global.data.banned[key]) return ctx.reply('That user is not banned.');
    delete ctx.env.db.global.data.banned[key]; ctx.env.db.saveGlobal();
    await ctx.reply(`✅ ${key} unbanned.`);
  },
});

const banlist = cmd({
  name: 'banlist', description: 'List globally banned users.',
  async run(ctx) {
    const rows = Object.entries(ctx.env.db.global.data.banned);
    await ctx.reply(rows.length ? `🚫 *Banned*\n${rows.map(([k, v]) => `• ${k} — ${v.reason}`).join('\n')}` : 'Nobody is banned.');
  },
});

// ───────── policy ─────────
const setrole = cmd({
  name: 'setrole', ...LOCK, description: 'Set the minimum role needed for a command/feature.', usage: 'setrole <command> <user|admin|superadmin|owner>',
  async run(ctx, args) {
    const f = featureFrom(ctx, args[0]); const role = args[1]?.toLowerCase();
    if (!f || !role || !isRole(role)) return ctx.reply(`Usage: ${ctx.prefix}setrole <command> <${ROLES.join('|')}>`);
    const r = ctx.env.policy.set(f, role);
    await ctx.reply(r.ok ? `✅ *${f}* now requires: ${role}+` : `⛔ ${r.error}`);
  },
});

const resetrole = cmd({
  name: 'resetrole', ...LOCK, description: 'Restore a feature\'s default role.', usage: 'resetrole <command>',
  async run(ctx, args) {
    const f = featureFrom(ctx, args[0]);
    if (!f) return ctx.reply(`Usage: ${ctx.prefix}resetrole <command>`);
    ctx.env.policy.reset(f);
    await ctx.reply(`✅ *${f}* restored to default (${ctx.env.policy.effectiveRole(f)}+).`);
  },
});

const perms = cmd({
  name: 'perms', aliases: ['permissions'], description: 'Show which features each tier can use.',
  async run(ctx) {
    const t = ctx.env.policy.tiers();
    const row = (icon: string, label: string, r: Role) => `${icon} *${label}*\n${t[r].join(', ') || '—'}`;
    await ctx.reply([
      row('👤', 'Everyone (user features)', 'user'),
      row('🛡️', 'Group admins', 'admin'),
      row('⭐', 'Superadmins', 'superadmin'),
      row('👑', 'Owner only', 'owner'),
      '\nTiers stack: superadmins can also use admin & user features.',
    ].join('\n\n'));
  },
});

const tierEditor = (name: 'superfeatures' | 'userfeatures'): Command => {
  const target: Role = name === 'superfeatures' ? 'superadmin' : 'user';
  const label = name === 'superfeatures' ? 'superadmins' : 'users';
  return cmd({
    name, ...LOCK,
    description: name === 'superfeatures' ? 'View/edit what superadmins may do.' : 'View/edit what ordinary users may do.',
    usage: `${name} [add|remove <command>]`,
    async run(ctx, args) {
      const sub = args[0]?.toLowerCase();
      const { policy } = ctx.env;
      if (sub === 'add' || sub === 'remove') {
        const f = featureFrom(ctx, args[1]);
        if (!f) return ctx.reply(`Unknown command. Usage: ${ctx.prefix}${name} ${sub} <command>`);
        const cur = policy.effectiveRole(f);
        if (sub === 'add') {
          if (ROLES.indexOf(cur) <= ROLES.indexOf(target)) return ctx.reply(`ℹ️ *${f}* is already available to ${label} (tier: ${cur}).`);
          const r = policy.set(f, target);
          return ctx.reply(r.ok ? `✅ *${f}* can now be used by ${label}.` : `⛔ ${r.error}`);
        }
        if (cur !== target) {
          return ctx.reply(cur === 'owner' ? `ℹ️ *${f}* is already owner-only.` : `ℹ️ *${f}* belongs to the "${cur}" tier, which includes ${label}. Use ${ctx.prefix}setrole ${f} <role> to change that tier.`);
        }
        const fallback: Role = target === 'superadmin' ? 'owner' : 'admin';
        const r = policy.set(f, fallback);
        return ctx.reply(r.ok ? `✅ *${f}* is no longer available to ${label} (now ${fallback}+).` : `⛔ ${r.error}`);
      }
      const t = policy.tiers();
      await ctx.reply(`${target === 'superadmin' ? '⭐' : '👤'} *Features set for ${label}:*\n${t[target].join(', ') || '—'}\n\nEdit: ${ctx.prefix}${name} add|remove <command>`);
    },
  });
};

// ───────── bot ─────────
const setprefix = cmd({
  name: 'setprefix', ...LOCK, description: 'Change the command prefix.', usage: 'setprefix <1-3 chars>',
  async run(ctx, args) {
    const p = args[0];
    if (!p || p.length > 3 || /\s/.test(p)) return ctx.reply(`Current prefix: ${ctx.prefix}\nUsage: ${ctx.prefix}setprefix <1-3 chars>`);
    ctx.env.db.global.data.prefix = p; ctx.env.db.saveGlobal();
    await ctx.reply(`✅ Prefix is now *${p}*`);
  },
});

const mode = cmd({
  name: 'mode', description: 'public = everyone can use commands; private = only owner & superadmins.', usage: 'mode public|private',
  async run(ctx, args) {
    const m = args[0]?.toLowerCase();
    if (m !== 'public' && m !== 'private') return ctx.reply(`Mode: ${ctx.env.db.global.data.mode}\nUsage: ${ctx.prefix}mode public|private`);
    ctx.env.db.global.data.mode = m; ctx.env.db.saveGlobal();
    await ctx.reply(`✅ Mode: ${m}. Filters keep protecting groups either way.`);
  },
});

const health = cmd({
  name: 'health', aliases: ['stats'], description: 'baileys-antiban health, rate limits and uptime.',
  async run(ctx) {
    const s: any = (ctx.env.safe as any).antiban?.getStats?.();
    if (!s) return ctx.reply('Anti-ban stats unavailable.');
    const rl = s.rateLimiter ?? {}, h = s.health ?? {}, w = s.warmUp ?? {};
    await ctx.reply([
      '🛡️ *Anti-ban status*',
      `Risk: ${h.risk ?? '?'} (score ${h.score ?? '?'})`,
      `Sent: ${rl.lastMinute ?? '?'}/min • ${rl.lastHour ?? '?'}/hour • blocked ${s.totalBlocked ?? 0}`,
      `Added delay so far: ${Math.round((s.totalDelayMs ?? 0) / 1000)}s`,
      w.phase ? `Warm-up: ${w.phase}${w.day ? ` day ${w.day}/${w.totalDays}` : ''}` : '',
      `Uptime: ${formatUptime(Date.now() - ctx.env.startedAt)}`,
      `Cached groups: ${ctx.env.groups.all().length}`,
    ].filter(Boolean).join('\n'));
  },
});

const groups = cmd({
  name: 'groups', description: 'List groups the bot is in.',
  async run(ctx) {
    const all = await ctx.env.sock.groupFetchAllParticipating();
    const rows = Object.values(all).map((g) => `• ${g.subject} (${g.participants.length}) ${g.id}`);
    await ctx.reply(rows.length ? `📚 *Groups (${rows.length})*\n${rows.join('\n')}` : 'Not in any group.');
  },
});

const leave = cmd({
  name: 'leave', description: 'Make the bot leave a group (run inside it, or give the group id).', usage: 'leave [group-id@g.us]',
  async run(ctx, args) {
    const id = args[0] ?? (ctx.isGroup ? ctx.chat : '');
    if (!id.endsWith('@g.us')) return ctx.reply(`Usage: ${ctx.prefix}leave <group-id@g.us> (see ${ctx.prefix}groups)`);
    await ctx.reply('👋 Leaving.');
    await ctx.env.sock.groupLeave(id);
  },
});

const shutdown = cmd({
  name: 'shutdown', aliases: ['stop'], ...LOCK, description: 'Stop the bot process (restart it from your host).',
  async run(ctx) {
    await ctx.reply('🛑 Shutting down…');
    log.info('shutdown requested by owner');
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500);
  },
});

export const ownerModule: BotModule = {
  name: 'owner',
  description: 'Owner/superuser control panel: people, permission policy and bot controls.',
  commands: [addsuper, delsuper, supers, ban, unban, banlist, setrole, resetrole, perms, tierEditor('superfeatures'), tierEditor('userfeatures'), setprefix, mode, health, groups, leave, shutdown],
};
