/**
 * @module core/dispatcher
 * The heart: turns Baileys events into filter runs and command executions.
 *
 *  messages.upsert ─► guards ─► buildCtx ─► ban check ─► FILTERS (groups) ─► COMMAND
 *  group-participants.update ─► cache invalidation ─► module.onGroupParticipants (welcome/goodbye…)
 *  groups.update             ─► cache invalidation
 *
 * Guards (all silent): own echoes, duplicates, old messages (backlog after reconnect), protocol messages,
 * status/newsletter chats, fromMe messages in other people's private chats.
 *
 * Command gate order: mode(private) → scope(group/private) → group-disabled → cooldown →
 *   permission (policy) → bot-admin requirement → run (try/catch).
 * Docs: docs/01-CORE.md#dispatcher
 */
import type { WAMessage, WASocket } from 'baileys';
import type { BotEnv, Ctx, GroupParticipantsEvent, Role } from './types.js';
import { ROLE_RANK } from './types.js';
import { buildCtx, contentOf, parseCommand } from './context.js';
import { norm, userPart } from './jid.js';
import { makeLog } from './logger.js';
import { SentIds } from './sentIds.js';

const log = makeLog('dispatch');

const DENY: Record<Role, string> = {
  user: '',
  admin: '⛔ This command is for group admins.',
  superadmin: '⛔ This command is for the bot\'s superadmins.',
  owner: '⛔ Owner only.',
};

export class Dispatcher {
  private cooldown = new Map<string, number>();
  /** message ids already handled (Baileys can deliver one message as both 'notify' and 'append') */
  private seen = new SentIds(2000);
  constructor(private env: BotEnv) {}

  /** Bind to the CURRENT socket. Called again after every reconnect (old socket's listeners die with it). */
  attach(sock: WASocket) {
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // 'append' can carry messages the owner typed on their own phone; the age guard + `seen` dedupe make it safe.
      if (type !== 'notify' && type !== 'append') return;
      void this.handleBatch(messages);
    });
    sock.ev.on('group-participants.update', (ev) => void this.onParticipants(ev as unknown as GroupParticipantsEvent));
    sock.ev.on('groups.update', (updates) => {
      for (const u of updates) if (u.id) this.env.groups.invalidate(u.id);
    });
  }

  async handleBatch(messages: WAMessage[]) {
    for (const m of messages) {
      try { await this.handleMessage(m); }
      catch (err) { log.error('handleMessage crashed:', err); }
    }
  }

  async handleMessage(msg: WAMessage) {
    const { env } = this;
    if (!msg.message) return;
    if (env.sent.has(msg.key.id)) return;
    if (msg.key.id) { if (this.seen.has(msg.key.id)) return; this.seen.add(msg.key.id); }

    const ts = Number((msg.messageTimestamp as any)?.toNumber?.() ?? msg.messageTimestamp ?? 0);
    if (ts && Date.now() / 1000 - ts > env.config.maxMessageAgeSec) return;

    const { type } = contentOf(msg);
    if (type === 'protocolMessage' || type === 'senderKeyDistributionMessage' || type === 'reactionMessage') return;

    const ctx = await buildCtx(env, msg);
    if (!ctx) return;

    if (ctx.fromMe && !ctx.isGroup) {
      const own = [env.sock.user?.id, (env.sock.user as any)?.lid].filter(Boolean).map((j) => norm(j as string));
      if (!own.includes(norm(ctx.chat))) return; // owner chatting with someone else — not for us
    }

    const banKey = ctx.senderPn ?? userPart(ctx.sender);
    if (ctx.role !== 'owner' && env.db.global.data.banned[banKey]) return;

    if (ctx.isGroup && !ctx.fromMe) {
      for (const f of env.registry.filters) {
        try { if (await f.run(ctx)) return; }
        catch (err) { log.error(`filter ${f.name} crashed:`, err); }
      }
    }

    const parsed = parseCommand(ctx.text, ctx.prefix);
    if (parsed) await this.execute(ctx, parsed.name, parsed.args, parsed.raw);
  }

  async execute(ctx: Ctx, name: string, args: string[], raw: string) {
    const { env } = this;
    const cmd = env.registry.find(name);
    if (!cmd) return;
    const feature = env.registry.featureOf(cmd);

    if (env.db.global.data.mode === 'private' && ROLE_RANK[ctx.role] < ROLE_RANK.superadmin) return;

    if (cmd.groupOnly && !ctx.isGroup) return ctx.reply('ℹ️ This command only works in groups.');
    if (cmd.privateOnly && ctx.isGroup) return ctx.reply('ℹ️ Use this command in a private chat with me.');

    if (ctx.isGroup && ROLE_RANK[ctx.role] < ROLE_RANK.superadmin &&
        env.db.settings(ctx.chat).disabled.includes(feature)) return;

    if (ctx.role !== 'owner' && env.config.cooldownMs > 0) {
      const key = `${ctx.chat}|${ctx.sender}`;
      const now = Date.now();
      if (now - (this.cooldown.get(key) ?? 0) < env.config.cooldownMs) return;
      this.cooldown.set(key, now);
      if (this.cooldown.size > 5000) this.cooldown.clear();
    }

    if (!env.policy.can(feature, ctx.role)) {
      return ctx.reply(DENY[env.policy.effectiveRole(feature)] || '⛔ Not allowed.');
    }

    if (cmd.needsBotAdmin && ctx.isGroup && !ctx.group?.botIsAdmin) {
      return ctx.reply('⚠️ I need to be a group admin to do that.');
    }

    try {
      await cmd.run(ctx, args, raw);
    } catch (err) {
      log.error(`command ${cmd.name} crashed:`, err);
      await ctx.reply('⚠️ Something went wrong running that command.');
    }
  }

  async onParticipants(ev: GroupParticipantsEvent) {
    const { env } = this;
    env.groups.invalidate(ev.id);
    for (const p of ev.participants ?? []) env.identity.learn((p as any).lid ?? p.id, p.phoneNumber);
    for (const mod of env.registry.modules) {
      if (!mod.onGroupParticipants) continue;
      try { await mod.onGroupParticipants(env, ev); }
      catch (err) { log.error(`module ${mod.name}.onGroupParticipants crashed:`, err); }
    }
  }
}
