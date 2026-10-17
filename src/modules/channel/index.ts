/**
 * @module modules/channel
 * WhatsApp Channel auto-poster + the owner's `.channel` control command.
 * Default role: owner (delegate with `.superfeatures add channel`). The scheduler is started from init().
 * Docs: docs/08-CHANNEL.md
 */
import type { BotEnv, BotModule, Command, Ctx } from '../../core/types.js';
import { makeLog } from '../../core/logger.js';
import { fetchFeed } from './feeds.js';
import { ChannelEngine, type TickResult } from './engine.js';
import { ChannelStore, LIMITS } from './store.js';
import { CATEGORIES, EMOJI, parseQuiet, truncate, type Category } from './text.js';
import { parseToggle, onOff } from '../../services/util.js';

const log = makeLog('channel');
let engine: ChannelEngine | null = null;

export function getEngine(env: BotEnv): ChannelEngine {
  if (!engine) {
    const store = new ChannelStore(env.config.dataDir);
    engine = new ChannelEngine({
      store,
      now: () => Date.now(),
      connected: () => !!env.sock?.user,
      riskOk: () => {
        const risk = (env.safe as any)?.antiban?.getStats?.()?.health?.risk;
        return risk !== 'high' && risk !== 'critical';
      },
      send: async (jid, text) => {
        try {
          const res = await env.safe.sendMessage(jid, { text }, {}); // options object is mandatory (see docs/07)
          env.sent.add(res?.key?.id);
          return !!res;
        } catch (err) { log.warn('channel send failed:', (err as Error)?.message); return false; }
      },
      log,
    });
  }
  return engine;
}
export const resetEngine = () => { engine = null; }; // tests

const TICK_MSG: Record<TickResult, string> = {
  posted: '✅ Posted.', off: 'Auto-posting is OFF (.channel on).', 'no-channel': 'No channel set (.channel set <link>).',
  offline: 'Not connected.', risk: '🛑 Anti-ban risk is high — posting paused automatically.', quiet: '😴 Quiet hours.',
  wait: 'Interval not elapsed yet.', 'day-cap': 'Daily cap reached.', empty: 'Queue has no eligible item (try .channel fetch).',
  'send-failed': '⚠️ Send failed; will retry later.', 'too-soon': `Last post was < ${LIMITS.minManualGapMin} min ago.`,
};

const ago = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; };
const parseCategory = (s?: string): Category | null => (CATEGORIES as string[]).includes(s ?? '') ? (s as Category) : null;

type Sub = (ctx: Ctx, args: string[], e: ChannelEngine) => Promise<void>;
const subs: Record<string, Sub> = {
  async status(ctx, _a, e) {
    const st = e.d_store.s, s = st.settings, now = Date.now();
    const q = CATEGORIES.map((c) => `${EMOJI[c]}${st.queue.filter((i) => i.category === c).length}`).join(' ');
    const next = e.nextEligibleAt();
    const quiet = parseQuiet(s.quiet);
    await ctx.reply([
      `📡 *Channel poster*: ${onOff(s.enabled)}${s.review ? ' • review mode' : ''}`,
      `Channel: ${s.jid || '— not set'}`,
      `Every ${s.intervalMin} min • today ${e.postsToday().length}/${s.maxPerDay} • quiet ${quiet ? s.quiet : 'off'} (${s.tz})`,
      `Last post: ${st.lastPostAt ? ago(now - st.lastPostAt) + ' ago' : 'never'} • next ≥ ${next > now ? 'in ' + ago(next - now) : 'now'}`,
      `Queue ${st.queue.length}: ${q}`,
      `Feeds: ${st.feeds.filter((f) => f.enabled).length}/${st.feeds.length} on • last fetch ${st.lastFetchAt ? ago(now - st.lastFetchAt) + ' ago' : 'never'}`,
    ].join('\n'));
  },

  async set(ctx, args, e) {
    const arg = args[0] ?? '';
    const code = arg.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/)?.[1];
    const isJid = /^\d+@newsletter$/.test(arg);
    if (!code && !isJid) return ctx.reply(`Usage: ${ctx.prefix}channel set <channel link | 1203…@newsletter>`);
    let jid = isJid ? arg : '';
    let info = '';
    try {
      const meta: any = await (ctx.env.sock as any).newsletterMetadata(code ? 'invite' : 'jid', code ?? arg);
      if (meta?.id) { jid = meta.id; info = `\n${meta.name ?? ''}${meta.subscribers != null ? ` • ${meta.subscribers} followers` : ''}`; }
    } catch (err) { if (!jid) return ctx.reply(`⚠️ Couldn't resolve that channel: ${(err as Error).message}`); }
    if (!jid) return ctx.reply("⚠️ Couldn't resolve that channel.");
    e.d_store.s.settings.jid = jid; e.d_store.save();
    await ctx.reply(`✅ Channel set: ${jid}${info}\nThe linked WhatsApp account must be the channel owner or an admin, or posts will fail. Turn on with ${ctx.prefix}channel on`);
  },

  async on(ctx, _a, e) {
    if (!e.d_store.s.settings.jid) return ctx.reply(`Set a channel first: ${ctx.prefix}channel set <link>`);
    e.d_store.s.settings.enabled = true; e.d_store.save();
    await ctx.reply('✅ Auto-posting ON.');
  },
  async off(ctx, _a, e) { e.d_store.s.settings.enabled = false; e.d_store.save(); await ctx.reply('⏸️ Auto-posting OFF.'); },

  async interval(ctx, args, e) {
    const n = Math.floor(Number(args[0]));
    if (!Number.isFinite(n) || n < LIMITS.minIntervalMin) return ctx.reply(`Minimum is ${LIMITS.minIntervalMin} minutes (account safety). Usage: ${ctx.prefix}channel interval <minutes>`);
    e.d_store.s.settings.intervalMin = Math.min(n, 1440); e.d_store.save();
    await ctx.reply(`✅ One post every ${e.d_store.s.settings.intervalMin} min.`);
  },
  async max(ctx, args, e) {
    const n = Math.floor(Number(args[0]));
    if (!Number.isFinite(n) || n < 1 || n > LIMITS.maxPerDay) return ctx.reply(`Usage: ${ctx.prefix}channel max <1-${LIMITS.maxPerDay}> (hard ceiling, account safety)`);
    e.d_store.s.settings.maxPerDay = n; e.d_store.save();
    await ctx.reply(`✅ Max ${n} posts/day.`);
  },
  async quiet(ctx, args, e) {
    const v = (args[0] ?? '').toLowerCase();
    if (v === 'off') { e.d_store.s.settings.quiet = ''; e.d_store.save(); return ctx.reply('✅ Quiet hours off.'); }
    if (!parseQuiet(v)) return ctx.reply(`Usage: ${ctx.prefix}channel quiet <from-to> e.g. 23-6 (local hours) | off`);
    e.d_store.s.settings.quiet = v; e.d_store.save();
    await ctx.reply(`✅ No posts between ${v.replace('-', ':00 and ')}:00 (${e.d_store.s.settings.tz}).`);
  },
  async review(ctx, args, e) {
    const t = parseToggle(args[0]);
    if (t === null) return ctx.reply(`Review mode: ${onOff(e.d_store.s.settings.review)}\nUsage: ${ctx.prefix}channel review on|off`);
    e.d_store.s.settings.review = t;
    if (!t) e.d_store.s.queue.forEach((i) => { i.approved = true; });
    e.d_store.save();
    await ctx.reply(t ? `✅ Review ON — new items wait for ${ctx.prefix}channel approve.` : '✅ Review OFF — everything queued is approved.');
  },

  async queue(ctx, _a, e) {
    const q = e.d_store.s.queue;
    if (!q.length) return ctx.reply(`Queue is empty. ${ctx.prefix}channel fetch`);
    await ctx.reply(q.slice(0, 12).map((i, n) => `${n + 1}. ${EMOJI[i.category]}${i.approved ? '' : '⏳'} ${truncate(i.title, 70)}`).join('\n') + (q.length > 12 ? `\n… +${q.length - 12} more` : '') + `\n\n${ctx.prefix}channel approve <n|all> • skip <n>`);
  },
  async approve(ctx, args, e) {
    const q = e.d_store.s.queue;
    if (args[0] === 'all') { q.forEach((i) => { i.approved = true; }); e.d_store.save(); return ctx.reply(`✅ Approved ${q.length}.`); }
    const it = q[Number(args[0]) - 1];
    if (!it) return ctx.reply(`Usage: ${ctx.prefix}channel approve <n|all>`);
    it.approved = true; e.d_store.save();
    await ctx.reply(`✅ Approved: ${truncate(it.title, 80)}`);
  },
  async skip(ctx, args, e) {
    const q = e.d_store.s.queue, idx = Number(args[0]) - 1;
    if (!q[idx]) return ctx.reply(`Usage: ${ctx.prefix}channel skip <n>`);
    const [gone] = q.splice(idx, 1);
    e.d_store.s.history.push({ id: gone!.id, key: gone!.key, category: gone!.category, at: Date.now(), link: gone!.link, skipped: true }); // remember so it never returns
    e.d_store.save();
    await ctx.reply(`🗑️ Skipped: ${truncate(gone!.title, 80)}`);
  },

  async postnow(ctx, _a, e) {
    const r = await e.tick({ force: true });
    await ctx.reply(TICK_MSG[r]);
  },
  async fetch(ctx, _a, e) {
    await ctx.reply('⏳ Fetching feeds…');
    const r = await e.refresh(true);
    if (r.skipped) return ctx.reply(`⏳ ${r.skipped}`);
    await ctx.reply(`📥 +${r.added} new • queue ${e.d_store.s.queue.length}${r.errors.length ? `\n⚠️ ${r.errors.slice(0, 6).join('\n⚠️ ')}` : ''}`);
  },

  async sources(ctx, _a, e) {
    const f = e.d_store.s.feeds;
    await ctx.reply(f.map((x, n) => `${n + 1}. ${x.enabled ? '✅' : '❌'} ${EMOJI[x.category]} ${x.name}${x.fails ? ` (${x.fails} fails)` : ''}${x.note ? `\n    ${x.note}` : ''}`).join('\n') +
      `\n\n${ctx.prefix}channel test <n> • feed <n> on|off • addfeed <category> <name> <url> • delfeed <n>`);
  },
  async test(ctx, args, e) {
    const feed = e.d_store.s.feeds[Number(args[0]) - 1];
    if (!feed) return ctx.reply(`Usage: ${ctx.prefix}channel test <n>  (see ${ctx.prefix}channel sources)`);
    try {
      const r = await fetchFeed(feed.url);
      await ctx.reply(`✅ ${feed.name}: ${r.items.length} items. Newest: ${truncate(r.items[0]?.title ?? '?', 80)}`);
    } catch (err) { await ctx.reply(`❌ ${feed.name}: ${(err as Error).message}`); }
  },
  async feed(ctx, args, e) {
    const feed = e.d_store.s.feeds[Number(args[0]) - 1], t = parseToggle(args[1]);
    if (!feed || t === null) return ctx.reply(`Usage: ${ctx.prefix}channel feed <n> on|off`);
    feed.enabled = t; feed.fails = 0; e.d_store.save();
    await ctx.reply(`${t ? '✅' : '❌'} ${feed.name}`);
  },
  async addfeed(ctx, args, e) {
    const cat = parseCategory(args[0]?.toLowerCase()), url = args.at(-1) ?? '', name = args.slice(1, -1).join(' ');
    if (!cat || !name || !/^https?:\/\//i.test(url)) return ctx.reply(`Usage: ${ctx.prefix}channel addfeed <${CATEGORIES.join('|')}> <name> <url>`);
    e.d_store.s.feeds.push({ name, url, category: cat, enabled: true, fails: 0 }); e.d_store.save();
    await ctx.reply(`✅ Added #${e.d_store.s.feeds.length}. Verify with ${ctx.prefix}channel test ${e.d_store.s.feeds.length}`);
  },
  async delfeed(ctx, args, e) {
    const n = Number(args[0]) - 1, f = e.d_store.s.feeds;
    if (!f[n]) return ctx.reply(`Usage: ${ctx.prefix}channel delfeed <n>`);
    const [gone] = f.splice(n, 1); e.d_store.save();
    await ctx.reply(`🗑️ Removed ${gone!.name}`);
  },
};

const HELP = `📡 *.channel* subcommands\nstatus • set <link> • on • off\ninterval <min≥${LIMITS.minIntervalMin}> • max <≤${LIMITS.maxPerDay}> • quiet <23-6|off> • review on|off\nqueue • approve <n|all> • skip <n> • postnow • fetch\nsources • test <n> • feed <n> on|off • addfeed • delfeed <n>`;

const channel: Command = {
  name: 'channel', defaultRole: 'owner',
  description: 'Manage the WhatsApp Channel auto-poster (tech/science/security news, blogs, free courses) at a fixed safe interval.',
  usage: 'channel [status|set|on|off|interval|max|quiet|review|queue|approve|skip|postnow|fetch|sources|test|feed|addfeed|delfeed]',
  async run(ctx, args) {
    const e = getEngine(ctx.env);
    const sub = (args[0] ?? 'status').toLowerCase();
    const fn = subs[sub];
    if (!fn) return ctx.reply(HELP);
    await fn(ctx, args.slice(1), e);
  },
};

export const channelModule: BotModule = {
  name: 'channel',
  description: 'WhatsApp Channel auto-poster: fixed-interval, rate-capped, deduplicated feed posts with an owner control command.',
  commands: [channel],
  init(env) {
    const e = getEngine(env);
    setInterval(() => { void e.tick().catch((err) => log.warn('tick failed', err)); }, 60_000).unref();
    const everyMs = Math.max(30, e.d_store.s.settings.fetchEveryMin) * 60_000;
    setInterval(() => { if (e.d_store.s.settings.enabled) void e.refresh().catch((err) => log.warn('refresh failed', err)); }, everyMs).unref();
    setTimeout(() => { if (e.d_store.s.settings.enabled && !e.d_store.s.queue.length) void e.refresh().catch(() => {}); }, 45_000).unref();
    process.on('exit', () => e.d_store.flush());
  },
};
