/**
 * @module modules/general
 * Commands every member can use (default role `user`): help/menu, ping, whoami, groupinfo.
 *   help    lists ONLY the commands the caller may use right now (policy-aware) and shows the real prefix.
 *   whoami  debugging aid for identity: shows role, raw jid, resolved phone, and what to put in OWNER_LIDS.
 * Docs: docs/04-MODULES.md#general
 */
import type { BotModule, Command } from '../../core/types.js';
import { ROLE_RANK } from '../../core/types.js';
import { isLid, userPart } from '../../core/jid.js';
import { formatUptime } from '../../services/util.js';

const ICON: Record<string, string> = { general: '📖', groupAdmin: '🛡️', protection: '🧱', warnings: '⚠️', welcome: '👋', owner: '👑' };

const help: Command = {
  name: 'help', aliases: ['menu', 'commands'], defaultRole: 'user',
  description: 'List the commands you can use, or details of one command.',
  usage: 'help [command]',
  async run(ctx, args) {
    const { registry, policy, db } = ctx.env;
    const p = ctx.prefix;

    if (args[0]) {
      const c = registry.find(args[0].replace(p, ''));
      if (!c) return ctx.reply(`Unknown command "${args[0]}". Try ${p}help`);
      const f = registry.featureOf(c);
      return ctx.reply(
        `*${p}${c.name}*${c.aliases?.length ? ` (${c.aliases.map((a) => p + a).join(', ')})` : ''}\n${c.description}\n` +
        `Usage: ${p}${c.usage ?? c.name}\nWho can use it: ${policy.effectiveRole(f)}+${c.groupOnly ? ' • groups only' : ''}${c.privateOnly ? ' • private chat only' : ''}`,
      );
    }

    const disabled = ctx.isGroup ? db.settings(ctx.chat).disabled : [];
    const byModule = new Map<string, string[]>();
    for (const c of registry.commands) {
      const f = registry.featureOf(c);
      if (!policy.can(f, ctx.role)) continue;
      if (disabled.includes(f) && ROLE_RANK[ctx.role] < ROLE_RANK.superadmin) continue;
      if (c.groupOnly && !ctx.isGroup) continue;
      if (c.privateOnly && ctx.isGroup) continue;
      (byModule.get(c.module) ?? byModule.set(c.module, []).get(c.module)!).push(p + c.name);
    }
    const body = [...byModule.entries()].map(([m, cmds]) => `${ICON[m] ?? '•'} *${m}*\n${cmds.join('  ')}`).join('\n\n');
    await ctx.reply(`🤖 *${ctx.env.config.botName}* — your role: *${ctx.role}*\n\n${body}\n\nDetails: ${p}help <command>`);
  },
};

const ping: Command = {
  name: 'ping', defaultRole: 'user', description: 'Check that the bot is alive.',
  async run(ctx) {
    const ts = Number((ctx.msg.messageTimestamp as any)?.toNumber?.() ?? ctx.msg.messageTimestamp ?? 0);
    const lag = ts ? Math.max(0, Date.now() - ts * 1000) : 0;
    await ctx.reply(`🏓 pong • delivery lag ~${Math.round(lag / 100) / 10}s • up ${formatUptime(Date.now() - ctx.env.startedAt)}`);
  },
};

const whoami: Command = {
  name: 'whoami', defaultRole: 'user', description: 'Show how the bot identifies you (role, JID, phone). Useful for owner setup.',
  async run(ctx) {
    const lines = [
      `👤 Role: *${ctx.role}*`,
      `JID: ${ctx.sender}`,
      `Phone: ${ctx.senderPn ? '+' + ctx.senderPn : 'not resolved (privacy ID)'}`,
    ];
    if (isLid(ctx.sender) && !ctx.senderPn) {
      lines.push(`\nIf you are the owner, add this to .env then restart:\nOWNER_LIDS=${userPart(ctx.sender)}`);
    }
    await ctx.reply(lines.join('\n'));
  },
};

const groupinfo: Command = {
  name: 'groupinfo', aliases: ['ginfo'], defaultRole: 'user', groupOnly: true, description: 'Basic information about this group.',
  async run(ctx) {
    const m = ctx.group?.meta;
    if (!m) return ctx.reply('Could not read group info.');
    const admins = m.participants.filter((p) => p.admin || p.isAdmin || p.isSuperAdmin).length;
    await ctx.reply(
      `ℹ️ *${m.subject}*\nMembers: ${m.participants.length} • Admins: ${admins}\n` +
      `Messages: ${m.announce ? 'admins only 🔇' : 'everyone 🔊'} • Edit info: ${m.restrict ? 'admins only 🔒' : 'everyone'}\n` +
      `Bot is admin: ${ctx.group?.botIsAdmin ? '✅' : '❌'}${m.desc ? `\n\n${m.desc.slice(0, 500)}` : ''}`,
    );
  },
};

export const generalModule: BotModule = {
  name: 'general',
  description: 'Help, ping, whoami and group info for everyone.',
  commands: [help, ping, whoami, groupinfo],
};
