/**
 * @module modules/warnings
 * Manual warning system. Automatic warnings (from filters set to action `warn`) share the same
 * counters (db.group(chat).warns, keyed by phone digits or normalized jid).
 * At the group's warn limit (.warnlimit, default 3) the member is removed and the counter resets.
 *   warn, unwarn, warns, resetwarn (admin) • mywarns (user)
 * Docs: docs/05-MODERATION.md#warnings
 */
import type { BotModule, Command, Ctx } from '../../core/types.js';
import { at, norm } from '../../core/jid.js';
import { addWarning, canAct, resolveTargets } from '../../services/moderation.js';

const cmd = (c: Command): Command => ({ groupOnly: true, ...c });
const keyOf = (t: { pn: string | null; jid: string }) => t.pn ?? norm(t.jid);

/** reason = args without @mentions / numbers */
const reasonFrom = (raw: string) => raw.replace(/@?\+?\d{7,15}/g, '').trim() || 'no reason given';

const warn = cmd({
  name: 'warn', defaultRole: 'admin',
  description: 'Warn a member. They are removed at the warn limit.',
  usage: 'warn @user [reason]',
  async run(ctx, args, raw) {
    const [t] = await resolveTargets(ctx, args);
    if (!t) return ctx.reply(`Usage: ${ctx.prefix}warn @user [reason]`);
    const why = canAct(ctx, t);
    if (why) return ctx.reply(`⚠️ ${why}`);
    const r = await addWarning(ctx, t, reasonFrom(raw));
    await ctx.send(
      `⚠️ ${at(t.jid)} warned — ${reasonFrom(raw)}\nWarning ${r.count}/${r.max}${r.kicked ? ' — limit reached, removed.' : ''}`,
      [t.jid],
    );
  },
});

const unwarn = cmd({
  name: 'unwarn', defaultRole: 'admin', description: 'Remove one warning from a member.', usage: 'unwarn @user',
  async run(ctx, args) {
    const [t] = await resolveTargets(ctx, args);
    if (!t) return ctx.reply(`Usage: ${ctx.prefix}unwarn @user`);
    const g = ctx.env.db.group(ctx.chat);
    const rec = g.warns[keyOf(t)];
    if (!rec || rec.count < 1) return ctx.reply('That member has no warnings.');
    rec.count -= 1; rec.reasons.pop();
    if (rec.count === 0) delete g.warns[keyOf(t)];
    ctx.env.db.saveGroups();
    await ctx.send(`✅ ${at(t.jid)} now has ${Math.max(rec.count, 0)}/${g.settings.maxWarns} warnings.`, [t.jid]);
  },
});

const resetwarn = cmd({
  name: 'resetwarn', aliases: ['clearwarns'], defaultRole: 'admin', description: 'Clear all warnings of a member.', usage: 'resetwarn @user',
  async run(ctx, args) {
    const [t] = await resolveTargets(ctx, args);
    if (!t) return ctx.reply(`Usage: ${ctx.prefix}resetwarn @user`);
    delete ctx.env.db.group(ctx.chat).warns[keyOf(t)];
    ctx.env.db.saveGroups();
    await ctx.send(`✅ Warnings cleared for ${at(t.jid)}.`, [t.jid]);
  },
});

const warns = cmd({
  name: 'warns', aliases: ['warnlist'], defaultRole: 'admin',
  description: 'Show a member\'s warnings, or the group\'s warning list.', usage: 'warns [@user]',
  async run(ctx, args) {
    const g = ctx.env.db.group(ctx.chat);
    const [t] = await resolveTargets(ctx, args);
    if (t) {
      const rec = g.warns[keyOf(t)];
      return ctx.send(rec ? `⚠️ ${at(t.jid)}: ${rec.count}/${g.settings.maxWarns}\n${rec.reasons.map((r) => `• ${r}`).join('\n')}` : `✅ ${at(t.jid)} has no warnings.`, [t.jid]);
    }
    const rows = Object.entries(g.warns).sort((a, b) => b[1].count - a[1].count).slice(0, 20);
    await ctx.reply(rows.length ? `⚠️ *Warnings* (limit ${g.settings.maxWarns})\n${rows.map(([k, v]) => `• ${k.split('@')[0]}: ${v.count}`).join('\n')}` : '✅ Nobody has warnings.');
  },
});

const mywarns = cmd({
  name: 'mywarns', defaultRole: 'user', description: 'Check your own warnings.',
  async run(ctx: Ctx) {
    const g = ctx.env.db.group(ctx.chat);
    const rec = g.warns[ctx.senderPn ?? norm(ctx.sender)];
    await ctx.reply(rec ? `⚠️ You have ${rec.count}/${g.settings.maxWarns} warnings.` : '✅ You have no warnings.');
  },
});

export const warningsModule: BotModule = {
  name: 'warnings',
  description: 'Warn / unwarn / reset with automatic removal at the limit.',
  commands: [warn, unwarn, resetwarn, warns, mywarns],
};
