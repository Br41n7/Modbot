/**
 * @module modules/protection
 * Admin commands that CONFIGURE the passive filters (filters.ts) + per-group switches.
 * Every command here is group-only, default role `admin`.
 * Docs: docs/05-MODERATION.md#protection-commands
 */
import type { BotModule, Command, Ctx } from '../../core/types.js';
import { antiBadword, antiLink, antiSpam, antiType, TYPE_MAP } from './filters.js';
import { onOff, parseAction, parseToggle } from '../../services/util.js';

const adminCmd = (c: Omit<Command, 'defaultRole' | 'groupOnly'>): Command => ({ defaultRole: 'admin', groupOnly: true, ...c });

const S = (ctx: Ctx) => ctx.env.db.settings(ctx.chat);
const save = (ctx: Ctx) => ctx.env.db.saveGroups();

const antilink = adminCmd({
  name: 'antilink',
  description: 'Configure link protection.',
  usage: 'antilink on|off [whatsapp|all] [delete|warn|kick] | antilink allow <text> | antilink unallow <text>',
  async run(ctx, args) {
    const s = S(ctx).antilink;
    const sub = args[0]?.toLowerCase();
    if (sub === 'allow' || sub === 'unallow') {
      const v = args.slice(1).join(' ').trim().toLowerCase();
      if (!v) return ctx.reply(`Usage: ${ctx.prefix}antilink ${sub} <domain or text>`);
      s.allow = sub === 'allow' ? [...new Set([...s.allow, v])] : s.allow.filter((a) => a !== v);
      save(ctx);
      return ctx.reply(`✅ Allow-list: ${s.allow.join(', ') || '(empty)'}`);
    }
    const t = parseToggle(sub);
    if (t === null) {
      return ctx.reply(`🔗 Anti-link: ${onOff(s.enabled)}\nMode: ${s.mode} • Action: ${s.action}\nAllowed: ${s.allow.join(', ') || '(none)'}\n\nUsage: ${ctx.prefix}antilink on|off [whatsapp|all] [delete|warn|kick]`);
    }
    s.enabled = t;
    for (const a of args.slice(1)) {
      if (a === 'whatsapp' || a === 'all') s.mode = a;
      const act = parseAction(a); if (act) s.action = act;
    }
    save(ctx);
    await ctx.reply(`🔗 Anti-link ${onOff(s.enabled)} • mode: ${s.mode} • action: ${s.action}`);
  },
});

const antisticker = adminCmd({
  name: 'antisticker',
  description: 'Auto-delete every sticker sent by non-exempt members.',
  usage: 'antisticker on|off',
  async run(ctx, args) {
    const s = S(ctx).antisticker;
    const t = parseToggle(args[0]);
    if (t === null) return ctx.reply(`🏷️ Anti-sticker: ${onOff(s.enabled)}\nUsage: ${ctx.prefix}antisticker on|off\n(Group admins are exempt unless you run ${ctx.prefix}exemptadmins off)`);
    s.enabled = t; save(ctx);
    await ctx.reply(`🏷️ Anti-sticker ${onOff(t)}${t && !ctx.group?.botIsAdmin ? '\n⚠️ I need to be a group admin to delete messages.' : ''}`);
  },
});

const blockCmd = (un: boolean): Command => adminCmd({
  name: un ? 'unblocktype' : 'blocktype',
  feature: 'blocktype',
  description: un ? 'Stop auto-deleting a message type.' : 'Auto-delete a whole message type (image, video, audio, document, contact, location, poll, sticker).',
  usage: un ? 'unblocktype <type>' : 'blocktype <type>  (no type = list)',
  async run(ctx, args) {
    const s = S(ctx);
    const type = args[0]?.toLowerCase();
    if (!type) return ctx.reply(`🚧 Blocked types: ${s.blockedTypes.join(', ') || '(none)'}\nAvailable: ${Object.keys(TYPE_MAP).join(', ')}\nUsage: ${ctx.prefix}blocktype <type> / ${ctx.prefix}unblocktype <type>`);
    if (!TYPE_MAP[type]) return ctx.reply(`Unknown type. Available: ${Object.keys(TYPE_MAP).join(', ')}`);
    s.blockedTypes = un ? s.blockedTypes.filter((x) => x !== type) : [...new Set([...s.blockedTypes, type])];
    save(ctx);
    await ctx.reply(`🚧 Blocked types: ${s.blockedTypes.join(', ') || '(none)'}`);
  },
});
const blocktype = blockCmd(false);
const unblocktype = blockCmd(true);

const antispam = adminCmd({
  name: 'antispam',
  description: 'Flood control.',
  usage: 'antispam on|off [maxMessages] [seconds] [delete|warn|kick]',
  async run(ctx, args) {
    const s = S(ctx).antispam;
    const t = parseToggle(args[0]);
    if (t === null) return ctx.reply(`💬 Anti-spam: ${onOff(s.enabled)}\n> ${s.max} msgs / ${s.windowSec}s → ${s.action}\nUsage: ${ctx.prefix}antispam on|off [max] [seconds] [delete|warn|kick]`);
    s.enabled = t;
    const nums = args.slice(1).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (nums[0]) s.max = Math.min(nums[0], 50);
    if (nums[1]) s.windowSec = Math.min(nums[1], 120);
    for (const a of args.slice(1)) { const act = parseAction(a); if (act) s.action = act; }
    save(ctx);
    await ctx.reply(`💬 Anti-spam ${onOff(s.enabled)} • > ${s.max} msgs / ${s.windowSec}s → ${s.action}`);
  },
});

const antibadword = adminCmd({
  name: 'antibadword',
  description: 'Banned-word filter and its word list.',
  usage: 'antibadword on|off | add <word> | del <word> | list | action <delete|warn|kick>',
  async run(ctx, args) {
    const s = S(ctx).antibadword;
    const sub = args[0]?.toLowerCase();
    const word = args.slice(1).join(' ').trim().toLowerCase();
    if (sub === 'add' && word) { s.words = [...new Set([...s.words, word])]; save(ctx); return ctx.reply(`✅ Added. ${s.words.length} word(s) banned.`); }
    if (sub === 'del' && word) { s.words = s.words.filter((w) => w !== word); save(ctx); return ctx.reply(`✅ Removed. ${s.words.length} word(s) banned.`); }
    if (sub === 'list') return ctx.reply(`🧼 Banned words (${s.words.length}): ${s.words.join(', ') || '(none)'}`);
    if (sub === 'action') {
      const a = parseAction(args[1]);
      if (!a) return ctx.reply('Action must be delete, warn or kick.');
      s.action = a; save(ctx); return ctx.reply(`🧼 Action: ${a}`);
    }
    const t = parseToggle(sub);
    if (t === null) return ctx.reply(`🧼 Bad-word filter: ${onOff(s.enabled)} • ${s.words.length} words • action ${s.action}\nUsage: ${ctx.prefix}antibadword on|off|add|del|list|action`);
    s.enabled = t; save(ctx);
    await ctx.reply(`🧼 Bad-word filter ${onOff(t)}`);
  },
});

const warnlimit = adminCmd({
  name: 'warnlimit',
  description: 'Warnings before an automatic removal (1-10).',
  usage: 'warnlimit <1-10>',
  async run(ctx, args) {
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 1 || n > 10) return ctx.reply(`Current limit: ${S(ctx).maxWarns}\nUsage: ${ctx.prefix}warnlimit <1-10>`);
    S(ctx).maxWarns = n; save(ctx);
    await ctx.reply(`✅ Members are removed after ${n} warning(s).`);
  },
});

const exemptadmins = adminCmd({
  name: 'exemptadmins',
  description: 'Whether group admins are immune to the filters (default on). Bot superadmins/owner are always immune.',
  usage: 'exemptadmins on|off',
  async run(ctx, args) {
    const t = parseToggle(args[0]);
    if (t === null) return ctx.reply(`🛡️ Admins exempt from filters: ${onOff(S(ctx).exemptAdmins)}`);
    S(ctx).exemptAdmins = t; save(ctx);
    await ctx.reply(`🛡️ Admins exempt from filters: ${onOff(t)}`);
  },
});

const settings = adminCmd({
  name: 'settings',
  aliases: ['config'],
  description: 'Show this group\'s protection settings.',
  async run(ctx) {
    const s = S(ctx);
    await ctx.reply(
      [
        '⚙️ *Group settings*',
        `🔗 Anti-link: ${onOff(s.antilink.enabled)} (${s.antilink.mode}/${s.antilink.action})`,
        `🏷️ Anti-sticker: ${onOff(s.antisticker.enabled)}`,
        `🚧 Blocked types: ${s.blockedTypes.join(', ') || '—'}`,
        `💬 Anti-spam: ${onOff(s.antispam.enabled)} (>${s.antispam.max}/${s.antispam.windowSec}s → ${s.antispam.action})`,
        `🧼 Bad words: ${onOff(s.antibadword.enabled)} (${s.antibadword.words.length}, ${s.antibadword.action})`,
        `👋 Welcome: ${onOff(s.welcome.enabled)} • Goodbye: ${onOff(s.goodbye.enabled)}`,
        `⚠️ Warn limit: ${s.maxWarns} • Admins exempt: ${onOff(s.exemptAdmins)}`,
        `🚫 Disabled commands: ${s.disabled.join(', ') || '—'}`,
        `🤖 Bot is admin: ${ctx.group?.botIsAdmin ? '✅' : '❌ (needed to enforce)'}`,
      ].join('\n'),
    );
  },
});

const NEVER_DISABLE = new Set(['enable', 'disable', 'help']);
const toggleCmd = (enable: boolean): Command => adminCmd({
  name: enable ? 'enable' : 'disable',
  feature: 'disable',
  description: enable ? 'Switch a bot command back on for this group.' : 'Switch a bot command off for this group only.',
  usage: enable ? 'enable <command>' : 'disable <command>  (no argument = list)',
  async run(ctx, args) {
    const s = S(ctx);
    const name = args[0]?.toLowerCase();
    if (!name) return ctx.reply(`🚫 Disabled here: ${s.disabled.join(', ') || '—'}\nUsage: ${ctx.prefix}disable <command> / ${ctx.prefix}enable <command>`);
    const cmd = ctx.env.registry.find(name);
    if (!cmd) return ctx.reply('Unknown command.');
    if (NEVER_DISABLE.has(cmd.name)) return ctx.reply("That one can't be disabled.");
    const feature = ctx.env.registry.featureOf(cmd);
    s.disabled = enable ? s.disabled.filter((f) => f !== feature) : [...new Set([...s.disabled, feature])];
    save(ctx);
    await ctx.reply(`🚫 Disabled here: ${s.disabled.join(', ') || '—'}`);
  },
});
const disable = toggleCmd(false);
const enable = toggleCmd(true);

export const protectionModule: BotModule = {
  name: 'protection',
  description: 'Passive filters (anti-sticker, anti-link, anti-spam, bad words, type blocking) and their settings commands.',
  filters: [antiType, antiLink, antiSpam, antiBadword],
  commands: [antilink, antisticker, blocktype, unblocktype, antispam, antibadword, warnlimit, exemptadmins, settings, disable, enable],
};
