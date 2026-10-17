/**
 * @module modules/welcome
 * Welcome / goodbye messages driven by the `group-participants.update` event.
 * Template placeholders: {user} {group} {rules} {count}
 *   welcome on|off, goodbye on|off, setwelcome <text>, setgoodbye <text>
 * Docs: docs/05-MODERATION.md#welcome
 */
import type { BotModule, Command } from '../../core/types.js';
import { at, norm } from '../../core/jid.js';
import { onOff, parseToggle } from '../../services/util.js';
import { sendSafe } from '../../services/send.js';

const cmd = (c: Omit<Command, 'defaultRole'>): Command => ({ groupOnly: true, defaultRole: 'admin', ...c });

const toggle = (key: 'welcome' | 'goodbye'): Command => cmd({
  name: key,
  description: `Turn ${key} messages on or off.`,
  usage: `${key} on|off`,
  async run(ctx, args) {
    const s = ctx.env.db.settings(ctx.chat)[key];
    const t = parseToggle(args[0]);
    if (t === null) return ctx.reply(`${key}: ${onOff(s.enabled)}\nTemplate:\n${s.text}\n\nUsage: ${ctx.prefix}${key} on|off • ${ctx.prefix}set${key} <text>`);
    s.enabled = t; ctx.env.db.saveGroups();
    await ctx.reply(`${key} ${onOff(t)}`);
  },
});

const setText = (key: 'welcome' | 'goodbye'): Command => cmd({
  name: `set${key}`,
  feature: key,
  description: `Set the ${key} template. Placeholders: {user} {group} {rules} {count}`,
  usage: `set${key} <text>`,
  async run(ctx, _a, raw) {
    if (!raw) return ctx.reply(`Usage: ${ctx.prefix}set${key} <text with {user} {group} {rules} {count}>`);
    ctx.env.db.settings(ctx.chat)[key].text = raw.slice(0, 1500);
    ctx.env.db.saveGroups();
    await ctx.reply(`✅ ${key} template saved.`);
  },
});

export function renderTemplate(tpl: string, vars: { user: string; group: string; rules: string; count: number }) {
  return tpl
    .replaceAll('{user}', vars.user).replaceAll('{group}', vars.group)
    .replaceAll('{rules}', vars.rules).replaceAll('{count}', String(vars.count))
    .trim();
}

export const welcomeModule: BotModule = {
  name: 'welcome',
  description: 'Welcome and goodbye messages.',
  commands: [toggle('welcome'), toggle('goodbye'), setText('welcome'), setText('goodbye')],
  async onGroupParticipants(env, ev) {
    if (ev.action !== 'add' && ev.action !== 'remove') return;
    const s = env.db.settings(ev.id);
    const cfg = ev.action === 'add' ? s.welcome : s.goodbye;
    if (!cfg.enabled) return;

    const botKeys = [env.sock.user?.id, (env.sock.user as any)?.lid].filter(Boolean).map((j) => norm(j as string));
    const people = ev.participants.map((p) => p.id).filter((id) => !botKeys.includes(norm(id)));
    if (!people.length) return;

    const info = await env.groups.get(env.sock, ev.id);
    const text = renderTemplate(cfg.text, {
      user: people.map(at).join(' '),
      group: info?.meta.subject ?? 'the group',
      rules: s.rules ? `\n📜 Rules:\n${s.rules}` : '',
      count: info?.meta.participants.length ?? 0,
    });
    await sendSafe(env, ev.id, text, people);
  },
};
