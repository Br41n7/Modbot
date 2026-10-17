/**
 * @module modules/groupAdmin
 * Everyday group administration (default role `admin` unless noted). All group-only.
 *   kick, add*, promote, demote, mute, unmute, lock, unlock, tagall, hidetag, del,
 *   setname, setdesc, link, revoke, setrules, rules(user), admins(user)
 *   (* add defaults to `superadmin` — mass adds are the #1 WhatsApp ban trigger)
 * Safety rules for kick/promote/demote live in services/moderation.canAct().
 * Docs: docs/05-MODERATION.md#group-admin-commands
 */
import type { BotModule, Command, Ctx } from '../../core/types.js';
import { at, norm, pnJid, userPart } from '../../core/jid.js';
import { canAct, kickParticipant, resolveTargets } from '../../services/moderation.js';

const cmd = (c: Command): Command => ({ groupOnly: true, ...c });

const needTargets = async (ctx: Ctx, args: string[], usage: string) => {
  const t = await resolveTargets(ctx, args);
  if (!t.length) await ctx.reply(`Tag someone, reply to their message, or type their number.\nUsage: ${ctx.prefix}${usage}`);
  return t;
};

const kick = cmd({
  name: 'kick', aliases: ['remove'], defaultRole: 'admin', needsBotAdmin: true,
  description: 'Remove one or more members (mention, reply, or number).',
  usage: 'kick @user | (reply) kick | kick 2348012345678',
  async run(ctx, args) {
    const targets = await needTargets(ctx, args, 'kick @user');
    const done: string[] = [], failed: string[] = [];
    for (const t of targets) {
      const why = canAct(ctx, t);
      if (why) { failed.push(`${at(t.jid)} — ${why}`); continue; }
      if (!t.inGroup) { failed.push(`${at(t.jid)} — not in this group`); continue; }
      const r = await kickParticipant(ctx, t);
      (r.ok ? done : failed).push(r.ok ? at(t.jid) : `${at(t.jid)} — ${r.error}`);
    }
    const lines = [];
    if (done.length) lines.push(`🚫 Removed: ${done.join(', ')}`);
    if (failed.length) lines.push(`⚠️ Could not remove:\n${failed.join('\n')}`);
    if (lines.length) await ctx.reply(lines.join('\n'), targets.map((t) => t.jid));
  },
});

const add = cmd({
  name: 'add', defaultRole: 'superadmin', needsBotAdmin: true,
  description: 'Add members by phone number (rate-limited by baileys-antiban; risky on WhatsApp — use sparingly).',
  usage: 'add 2348012345678 [more numbers]',
  async run(ctx, args) {
    const nums = args.map((a) => a.replace(/\D/g, '')).filter((n) => n.length >= 7 && n.length <= 15);
    if (!nums.length) return ctx.reply(`Usage: ${ctx.prefix}add 2348012345678`);
    if (nums.length > 3) return ctx.reply('Add at most 3 numbers at a time.');
    try {
      const res: any = await ctx.env.participantsUpdate(ctx.chat, nums.map(pnJid), 'add');
      const MEANING: Record<string, string> = { '200': '✅ added', '403': '🔒 privacy settings — needs an invite', '408': '⏳ left recently', '409': 'ℹ️ already in group', '419': '❌ group is full' };
      const lines = (Array.isArray(res) ? res : []).map((r: any) => `+${userPart(r.jid)} ${MEANING[String(r.status)] ?? `status ${r.status}`}`);
      await ctx.reply(lines.join('\n') || '✅ Request sent.');
    } catch (err) {
      await ctx.reply(`⚠️ ${(err as Error).message}`);
    }
  },
});

const rankChange = (name: 'promote' | 'demote'): Command => cmd({
  name, defaultRole: 'admin', needsBotAdmin: true,
  description: name === 'promote' ? 'Make a member a group admin.' : 'Remove admin rights from a member.',
  usage: `${name} @user`,
  async run(ctx, args) {
    const targets = await needTargets(ctx, args, `${name} @user`);
    const ok: string[] = [], bad: string[] = [];
    for (const t of targets) {
      const isAdmin = !!ctx.group?.adminKeys.has(norm(t.jid));
      if (!t.inGroup) { bad.push(`${at(t.jid)} — not in this group`); continue; }
      if (name === 'promote' && isAdmin) { bad.push(`${at(t.jid)} — already an admin`); continue; }
      if (name === 'demote') {
        if (!isAdmin) { bad.push(`${at(t.jid)} — not an admin`); continue; }
        const why = canAct(ctx, t);
        if (why) { bad.push(`${at(t.jid)} — ${why}`); continue; }
      }
      try { await ctx.env.participantsUpdate(ctx.chat, [t.jid], name); ok.push(at(t.jid)); }
      catch (err) { bad.push(`${at(t.jid)} — ${(err as Error).message}`); }
    }
    ctx.env.groups.invalidate(ctx.chat);
    const lines = [];
    if (ok.length) lines.push(`${name === 'promote' ? '⬆️ Promoted' : '⬇️ Demoted'}: ${ok.join(', ')}`);
    if (bad.length) lines.push(`⚠️ Skipped:\n${bad.join('\n')}`);
    await ctx.reply(lines.join('\n'), targets.map((t) => t.jid));
  },
});

const setting = (name: string, aliases: string[], value: 'announcement' | 'not_announcement' | 'locked' | 'unlocked', msg: string, desc: string): Command =>
  cmd({
    name, aliases, defaultRole: 'admin', needsBotAdmin: true, description: desc,
    async run(ctx) {
      await ctx.env.sock.groupSettingUpdate(ctx.chat, value);
      ctx.env.groups.invalidate(ctx.chat);
      await ctx.send(msg);
    },
  });

const tagall = cmd({
  name: 'tagall', aliases: ['everyone'], defaultRole: 'admin',
  description: 'Mention every member (optional message).',
  usage: 'tagall [message]',
  async run(ctx, args) {
    const ids = (ctx.group?.meta.participants ?? []).map((p) => p.id).slice(0, 1024);
    const body = args.join(' ').trim();
    const list = ids.map((id) => `• ${at(id)}`).join('\n');
    await ctx.send(`📣 ${body || 'Attention everyone'}\n\n${list}`, ids);
  },
});

const hidetag = cmd({
  name: 'hidetag', aliases: ['h'], defaultRole: 'admin',
  description: 'Notify everyone without showing the @list.',
  usage: 'hidetag <message>',
  async run(ctx, _args, raw) {
    const ids = (ctx.group?.meta.participants ?? []).map((p) => p.id).slice(0, 1024);
    if (!raw) return ctx.reply(`Usage: ${ctx.prefix}hidetag <message>`);
    await ctx.send(raw, ids);
  },
});

const del = cmd({
  name: 'del', aliases: ['delete'], defaultRole: 'admin', needsBotAdmin: true,
  description: 'Delete the message you reply to.',
  usage: '(reply to a message) del',
  async run(ctx) {
    if (!ctx.quoted) return ctx.reply(`Reply to the message you want deleted, then send ${ctx.prefix}del`);
    await ctx.deleteMsg(ctx.quoted.key);
    await ctx.deleteMsg(); // tidy up the command itself
  },
});

const setname = cmd({
  name: 'setname', defaultRole: 'admin', needsBotAdmin: true,
  description: 'Change the group name.', usage: 'setname <new name>',
  async run(ctx, _a, raw) {
    if (!raw) return ctx.reply(`Usage: ${ctx.prefix}setname <new name>`);
    if (raw.length > 100) return ctx.reply('Name too long (max 100).');
    await ctx.env.sock.groupUpdateSubject(ctx.chat, raw);
    ctx.env.groups.invalidate(ctx.chat);
    await ctx.send('✅ Group name updated.');
  },
});

const setdesc = cmd({
  name: 'setdesc', defaultRole: 'admin', needsBotAdmin: true,
  description: 'Change the group description.', usage: 'setdesc <text>',
  async run(ctx, _a, raw) {
    if (!raw) return ctx.reply(`Usage: ${ctx.prefix}setdesc <text>`);
    await ctx.env.sock.groupUpdateDescription(ctx.chat, raw.slice(0, 2048));
    ctx.env.groups.invalidate(ctx.chat);
    await ctx.send('✅ Description updated.');
  },
});

const link = cmd({
  name: 'link', aliases: ['invite'], defaultRole: 'admin', needsBotAdmin: true,
  description: 'Get the group invite link.',
  async run(ctx) {
    const code = await ctx.env.sock.groupInviteCode(ctx.chat);
    await ctx.reply(code ? `🔗 https://chat.whatsapp.com/${code}` : '⚠️ Could not fetch the invite link.');
  },
});

const revoke = cmd({
  name: 'revoke', aliases: ['resetlink'], defaultRole: 'admin', needsBotAdmin: true,
  description: 'Invalidate the old invite link and create a new one.',
  async run(ctx) {
    const code = await ctx.env.sock.groupRevokeInvite(ctx.chat);
    await ctx.reply(code ? `🔄 New link: https://chat.whatsapp.com/${code}` : '⚠️ Could not reset the link.');
  },
});

const setrules = cmd({
  name: 'setrules', defaultRole: 'admin',
  description: 'Set the group rules shown by .rules and in the welcome message.', usage: 'setrules <text>',
  async run(ctx, _a, raw) {
    const s = ctx.env.db.settings(ctx.chat);
    if (!raw) { s.rules = ''; ctx.env.db.saveGroups(); return ctx.reply('🗑️ Rules cleared.'); }
    s.rules = raw.slice(0, 3000);
    ctx.env.db.saveGroups();
    await ctx.reply('✅ Rules saved.');
  },
});

const rules = cmd({
  name: 'rules', defaultRole: 'user', description: 'Show the group rules.',
  async run(ctx) {
    const r = ctx.env.db.settings(ctx.chat).rules;
    await ctx.reply(r ? `📜 *Group rules*\n${r}` : `No rules set yet. Admins: ${ctx.prefix}setrules <text>`);
  },
});

const admins = cmd({
  name: 'admins', aliases: ['staff'], defaultRole: 'user',
  description: 'Mention the group admins (use when you need help).',
  async run(ctx) {
    const ids = (ctx.group?.meta.participants ?? []).filter((p) => p.admin || p.isAdmin || p.isSuperAdmin).map((p) => p.id);
    if (!ids.length) return ctx.reply('Could not read the admin list.');
    await ctx.reply(`🛡️ *Admins*\n${ids.map((i) => `• ${at(i)}`).join('\n')}`, ids);
  },
});

export const groupAdminModule: BotModule = {
  name: 'groupAdmin',
  description: 'Day-to-day group administration commands.',
  commands: [
    kick, add, rankChange('promote'), rankChange('demote'),
    setting('mute', ['close'], 'announcement', '🔇 Group closed — only admins can send messages.', 'Only admins can send messages.'),
    setting('unmute', ['open'], 'not_announcement', '🔊 Group opened — everyone can send messages.', 'Let everyone send messages.'),
    setting('lock', [], 'locked', '🔒 Only admins can edit group info.', 'Only admins can edit group info.'),
    setting('unlock', [], 'unlocked', '🔓 Everyone can edit group info.', 'Everyone can edit group info.'),
    tagall, hidetag, del, setname, setdesc, link, revoke, setrules, rules, admins,
  ],
};
