import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseFeedXml } from '../src/modules/channel/feeds.js';
import { formatPost, inQuiet, localParts, normalizeLink, parseQuiet, stripHtml, titleKey, truncate } from '../src/modules/channel/text.js';
import { ChannelEngine, isTechCourse } from '../src/modules/channel/engine.js';
import { ChannelStore, LIMITS } from '../src/modules/channel/store.js';
import { resetEngine } from '../src/modules/channel/index.js';
import { makeEnv, msg, P } from './helpers.js';
import { config } from '../src/config.js';
import { wireAntiban } from '../src/core/antibanSetup.js';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Big &amp; &lt;b&gt;bold&lt;/b&gt; news</title><link>https://ex.com/a?utm_source=x</link><pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Hello <a href="#">world</a>&nbsp;again.</p>]]></description></item>
<item><title>Second</title><guid>https://ex.com/b</guid><description>plain</description></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom one</title><link rel="alternate" href="https://ex.com/atom1"/><link rel="self" href="https://ex.com/self"/><updated>2026-10-14T07:00:00Z</updated><summary>S</summary></entry></feed>`;

test('RSS and Atom parsing', () => {
  const r = parseFeedXml(RSS);
  assert.equal(r.length, 2);
  assert.equal(r[0]!.title, 'Big & bold news');
  assert.equal(r[0]!.summary, 'Hello world again.');
  assert.equal(r[0]!.published, Date.parse('2026-10-14T08:00:00Z'));
  assert.equal(r[1]!.link, 'https://ex.com/b');
  const a = parseFeedXml(ATOM);
  assert.equal(a[0]!.link, 'https://ex.com/atom1');
  assert.equal(a[0]!.published, Date.parse('2026-10-14T07:00:00Z'));
  assert.throws(() => parseFeedXml('<html></html>').length || (() => { throw new Error('empty'); })());
});

test('text helpers', () => {
  assert.equal(normalizeLink('https://ex.com/a/?utm_source=x&id=2#frag'), 'https://ex.com/a/?id=2');
  assert.equal(normalizeLink('https://ex.com/a/'), 'https://ex.com/a');
  assert.equal(normalizeLink('javascript:alert(1)'), null);
  assert.equal(titleKey('Hello, World!  It\'s Café'), 'hello world it s cafe');
  assert.equal(stripHtml('<script>x</script><p>a&amp;b</p>'), 'a&b');
  assert.ok(truncate('word '.repeat(100), 50).length <= 51);
  const post = formatPost({ title: 'A *bold* title', summary: 'Sum', link: 'https://x.y/z', source: 'Src', category: 'security' });
  assert.match(post, /^🔐 \*A bold title\*\n\nSum\n\n🔗 https:\/\/x\.y\/z\n\n— Src$/);
  assert.deepEqual(parseQuiet('23-6'), { from: 23, to: 6 });
  assert.equal(parseQuiet('abc'), null);
  assert.equal(inQuiet(23, { from: 23, to: 6 }), true);
  assert.equal(inQuiet(5, { from: 23, to: 6 }), true);
  assert.equal(inQuiet(6, { from: 23, to: 6 }), false);
  assert.equal(localParts(Date.UTC(2026, 9, 14, 23, 30), 'Africa/Lagos').hour, 0); // UTC+1
});

test('tech-only course filter', () => {
  assert.equal(isTechCourse('[100% OFF] Python for Beginners'), true);
  assert.equal(isTechCourse('Learn C++ Pointers'), true);
  assert.equal(isTechCourse('Makeup Artistry Masterclass'), false);
  assert.equal(isTechCourse('Wedding Photography'), false);
  assert.equal(isTechCourse('Cyber Security Basics'), true);
});

// ───────── engine harness ─────────
const T0 = Date.UTC(2026, 9, 14, 10, 0, 0); // 11:00 Lagos
const H = 3_600_000, M = 60_000;

function engineFor(over: Partial<any> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-'));
  const store = new ChannelStore(dir);
  Object.assign(store.s.settings, { enabled: true, jid: '1203630000@newsletter', intervalMin: 180, maxPerDay: 6, quiet: '23-6', tz: 'Africa/Lagos', review: false, ...over.settings });
  let now = T0;
  const sent: string[] = [];
  const st = { connected: true, risk: true, sendOk: true };
  const feeds: Record<string, any> = {};
  const e = new ChannelEngine({
    store, now: () => now, connected: () => st.connected, riskOk: () => st.risk,
    send: async (_j, t) => { if (st.sendOk) sent.push(t); return st.sendOk; },
    fetchFeed: (async (url: string) => { const f = feeds[url]; if (f instanceof Error) throw f; return { items: f ?? [], notModified: false, http: {} }; }) as any,
  });
  const item = (n: number, category: any = 'tech', ageMin = 10) => ({
    id: `id${n}`, key: `key${n}`, title: `Title ${n}`, link: `https://ex.com/${n}`, summary: 's', source: 'S', category,
    published: now - ageMin * M, addedAt: now, approved: true, fails: 0, retryAfter: 0,
  });
  return { e, store, sent, st, feeds, item, setNow: (t: number) => { now = t; }, advance: (ms: number) => { now += ms; }, get now() { return now; } };
}

test('tick: posts one item, then enforces the fixed interval', async () => {
  const t = engineFor();
  t.store.s.queue.push(t.item(1), t.item(2, 'security'));
  assert.equal(await t.e.tick(), 'posted');
  assert.equal(await t.e.tick(), 'wait');
  t.advance(179 * M); assert.equal(await t.e.tick(), 'wait');
  t.advance(1 * M); assert.equal(await t.e.tick(), 'posted');
  assert.equal(t.sent.length, 2);
  assert.equal(await t.e.tick(), 'wait');
});

test('tick: after long downtime posts exactly ONE item (no burst catch-up)', async () => {
  const t = engineFor();
  t.store.s.queue.push(...[1, 2, 3, 4].map((n) => t.item(n)));
  assert.equal(await t.e.tick(), 'posted');
  t.advance(24 * H); // bot was offline for a day; items are still fresh enough? refresh them
  t.store.s.queue.forEach((i) => { i.published = t.now - 10 * M; });
  assert.equal(await t.e.tick(), 'posted');
  assert.equal(await t.e.tick(), 'wait');
  assert.equal(await t.e.tick(), 'wait');
  assert.equal(t.sent.length, 2);
});

test('tick gates: off, no channel, offline, risk, quiet hours, day cap', async () => {
  const t = engineFor();
  t.store.s.queue.push(...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => t.item(n, n % 2 ? 'tech' : 'science')));
  t.store.s.settings.enabled = false; assert.equal(await t.e.tick(), 'off');
  t.store.s.settings.enabled = true; t.store.s.settings.jid = ''; assert.equal(await t.e.tick(), 'no-channel');
  t.store.s.settings.jid = '1@newsletter';
  t.st.connected = false; assert.equal(await t.e.tick(), 'offline'); t.st.connected = true;
  t.st.risk = false; assert.equal(await t.e.tick(), 'risk'); t.st.risk = true;
  t.setNow(Date.UTC(2026, 9, 14, 23, 0, 0)); // 00:00 Lagos → quiet
  assert.equal(await t.e.tick(), 'quiet');
  t.setNow(T0);
  t.store.s.settings.maxPerDay = 2; t.store.s.settings.intervalMin = 30;
  assert.equal(await t.e.tick(), 'posted'); t.advance(31 * M); t.store.s.queue.forEach((i) => { i.published = t.now - M; });
  assert.equal(await t.e.tick(), 'posted'); t.advance(31 * M); t.store.s.queue.forEach((i) => { i.published = t.now - M; });
  assert.equal(await t.e.tick(), 'day-cap');
  t.advance(24 * H); t.store.s.queue.forEach((i) => { i.published = t.now - M; }); // next local day
  assert.equal(await t.e.tick(), 'posted');
});

test('tick: category rotation, course daily cap, freshness', async () => {
  const t = engineFor({ settings: { intervalMin: 30 } });
  t.store.s.queue.push(t.item(1, 'tech', 1), t.item(2, 'tech', 2), t.item(3, 'security', 3));
  await t.e.tick(); assert.equal(t.store.s.lastCategory, 'tech');
  t.advance(31 * M); t.store.s.queue.forEach((i) => { i.published = t.now - M; });
  await t.e.tick(); assert.equal(t.store.s.lastCategory, 'security', 'prefers a different category than the last post');

  const c = engineFor({ settings: { intervalMin: 30, courseMaxPerDay: 1 } });
  c.store.s.queue.push(c.item(1, 'course', 1), c.item(2, 'course', 2));
  await c.e.tick();
  c.advance(31 * M); c.store.s.queue.forEach((i) => { i.published = c.now - M; });
  assert.equal(await c.e.tick(), 'empty', 'second course blocked by daily course cap');

  const f = engineFor();
  f.store.s.queue.push(f.item(1, 'course', 7 * 60)); // 7h old > 6h course limit
  assert.equal(await f.e.tick(), 'empty');
  f.store.s.queue.push(f.item(2, 'tech', 30 * 60)); // 30h < 48h
  assert.equal(await f.e.tick(), 'posted');
});

test('review mode: only approved items post', async () => {
  const t = engineFor({ settings: { review: true } });
  const a = t.item(1); a.approved = false;
  t.store.s.queue.push(a);
  assert.equal(await t.e.tick(), 'empty');
  a.approved = true;
  assert.equal(await t.e.tick(), 'posted');
});

test('send failure: retry later, drop after 3 fails; postnow respects min gap', async () => {
  const t = engineFor({ settings: { intervalMin: 30 } });
  t.store.s.queue.push(t.item(1));
  t.st.sendOk = false;
  assert.equal(await t.e.tick(), 'send-failed');
  assert.equal(await t.e.tick(), 'empty', 'retryAfter blocks immediate retry');
  t.advance(11 * M); t.store.s.queue[0]!.published = t.now - M;
  assert.equal(await t.e.tick(), 'send-failed');
  t.advance(11 * M); t.store.s.queue[0]!.published = t.now - M;
  assert.equal(await t.e.tick(), 'send-failed');
  assert.equal(t.store.s.queue.length, 0, 'dropped after 3 failures');
  t.st.sendOk = true; t.store.s.queue.push(t.item(2));
  assert.equal(await t.e.tick({ force: true }), 'posted');
  t.store.s.queue.push(t.item(3));
  assert.equal(await t.e.tick({ force: true }), 'too-soon');
});

test('refresh: dedupe vs queue/history, stale drop, course keyword filter, feed auto-disable', async () => {
  const t = engineFor();
  t.store.s.feeds = [
    { name: 'A', url: 'u-a', category: 'tech', enabled: true, fails: 0 },
    { name: 'C', url: 'u-c', category: 'course', enabled: true, fails: 0 },
    { name: 'Bad', url: 'u-bad', category: 'tech', enabled: true, fails: 0 },
  ];
  const now = t.now;
  t.feeds['u-a'] = [
    { title: 'Fresh story', link: 'https://ex.com/1?utm_source=a', summary: '<p>x</p>', published: now - M },
    { title: 'Old story', link: 'https://ex.com/old', summary: '', published: now - 100 * H },
    { title: 'Posted before', link: 'https://ex.com/seen', summary: '', published: now - M },
    { title: 'Fresh story', link: 'https://ex.com/1-mirror', summary: '', published: now - M },
  ];
  t.feeds['u-c'] = [
    { title: '[100% OFF] Python Bootcamp', link: 'https://udemy.com/python', summary: '', published: now - M },
    { title: 'Makeup Artistry', link: 'https://udemy.com/makeup', summary: '', published: now - M },
  ];
  t.feeds['u-bad'] = new Error('HTTP 500');
  t.store.s.history.push({ id: 'x', key: titleKey('Posted before'), category: 'tech', at: now - H, link: 'https://ex.com/seen' });

  const r = await t.e.refresh();
  assert.equal(r.added, 2);
  assert.deepEqual(t.store.s.queue.map((i) => i.title).sort(), ['Fresh story', '[100% OFF] Python Bootcamp']);
  assert.equal(t.store.s.queue.find((i) => i.title === 'Fresh story')!.link, 'https://ex.com/1');
  assert.equal(r.errors.length, 1);
  for (let i = 0; i < LIMITS.feedAutoDisableAfter; i++) await t.e.refresh();
  assert.equal(t.store.s.feeds[2]!.enabled, false, 'dead feed auto-disabled');
  assert.equal((await t.e.refresh()).added, 0, 'no duplicates on later refreshes');
});

test('manual fetch is rate-limited', async () => {
  const t = engineFor();
  t.store.s.feeds = [];
  assert.equal((await t.e.refresh(true)).skipped, undefined);
  assert.ok((await t.e.refresh(true)).skipped);
  t.advance(6 * M);
  assert.equal((await t.e.refresh(true)).skipped, undefined);
});

test('default feeds: only tech/science/security/blog enabled; course aggregator disabled until verified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-'));
  const s = new ChannelStore(dir).s;
  assert.ok(s.feeds.filter((f) => f.enabled).every((f) => f.category !== 'course'));
  assert.ok(s.feeds.some((f) => f.category === 'course' && !f.enabled && f.note));
});

// ───────── command + permissions ─────────
test('.channel command: owner-only, safety floors, set/queue/approve/skip, delegation', async () => {
  resetEngine();
  const t = await makeEnv();
  (t.env.sock as any).newsletterMetadata = async () => ({ id: '120363999@newsletter', name: 'My Tech Channel', subscribers: 42 });
  const say = (from: any, text: string) => t.dispatcher.handleMessage(msg({ from, text }));

  await say(P.alice, '.channel status');
  assert.match(t.texts().at(-1)!, /group admins|Owner only/);

  await say(P.owen, '.channel set https://whatsapp.com/channel/0029VabcDEF123');
  assert.match(t.texts().at(-1)!, /120363999@newsletter[\s\S]*My Tech Channel/);
  await say(P.owen, '.channel interval 5');
  assert.match(t.texts().at(-1)!, /Minimum is 30/);
  await say(P.owen, '.channel max 50');
  assert.match(t.texts().at(-1)!, /Usage/);
  await say(P.owen, '.channel interval 240');
  await say(P.owen, '.channel max 4');
  await say(P.owen, '.channel quiet 22-7');
  await say(P.owen, '.channel on');
  await say(P.owen, '.channel status');
  const status = t.texts().at(-1)!;
  assert.match(status, /ON/); assert.match(status, /Every 240 min/); assert.match(status, /0\/4/); assert.match(status, /22-7/);

  const { getEngine } = await import('../src/modules/channel/index.js');
  const e = getEngine(t.env);
  e.d_store.s.queue.push({ id: 'q1', key: 'k1', title: 'Queued story', link: 'https://ex.com/q', summary: '', source: 'S', category: 'tech', published: Date.now(), addedAt: Date.now(), approved: false, fails: 0, retryAfter: 0 });
  await say(P.owen, '.channel queue');
  assert.match(t.texts().at(-1)!, /1\. 💻⏳ Queued story/);
  await say(P.owen, '.channel approve 1');
  assert.equal(e.d_store.s.queue[0]!.approved, true);
  await say(P.owen, '.channel skip 1');
  assert.equal(e.d_store.s.queue.length, 0);
  assert.ok(e.d_store.s.history.some((h) => h.skipped), 'skipped item is remembered but not counted as a post');
  assert.equal(e.postsToday().length, 0);

  // owner delegates the whole feature to superadmins
  await say(P.sam, '.channel status');
  assert.match(t.texts().at(-1)!, /Owner only/);
  await say(P.owen, '.superfeatures add channel');
  await say(P.sam, '.channel status');
  assert.match(t.texts().at(-1)!, /Channel poster/);

  await say(P.owen, '.channel bogus');
  assert.match(t.texts().at(-1)!, /subcommands/);
  await say(P.owen, '.channel addfeed science My Feed https://ex.com/feed.xml');
  assert.equal(e.d_store.s.feeds.at(-1)!.name, 'My Feed');
});

// ───────── real anti-ban wrapper with a newsletter jid ─────────
test('anti-ban wrapper delivers a text post to a @newsletter jid', async () => {
  Object.assign(config.antiban, { warmupDays: 0, preset: 'moderate', legitimacySignals: false });
  const calls: any[] = [];
  const ev: any = new EventEmitter(); ev.process = () => {};
  const sock: any = { ev, user: { id: '2349000000000:1@s.whatsapp.net' }, groupParticipantsUpdate: async () => [],
    sendMessage: async (jid: string, content: any, options: any) => { calls.push({ jid, content, options }); return { key: { id: 'N1' } }; } };
  const { safe } = wireAntiban(sock, { persist: undefined, minDelayMs: 0, maxDelayMs: 1 });
  const res: any = await safe.sendMessage('120363000000@newsletter', { text: 'post' }, {});
  assert.equal(res?.key?.id, 'N1');
  assert.equal(calls[0].jid, '120363000000@newsletter');
  assert.equal(calls[0].content.text, 'post');
  (safe as any).antiban?.destroy?.();
});
