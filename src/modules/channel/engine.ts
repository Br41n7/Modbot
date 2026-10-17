/**
 * @module modules/channel/engine
 * The poster. Pure logic with injected dependencies (clock, sender, fetcher) so it is fully unit-tested.
 *
 *  refresh()  fetch feeds → filter → dedupe → queue            (every fetchEveryMin, default 60)
 *  tick()     runs every minute; posts AT MOST ONE item when ALL gates pass:
 *             enabled · channel set · connected · anti-ban risk ok · not quiet hours ·
 *             interval elapsed since the LAST post · daily cap · course daily cap · a fresh, approved item exists
 *
 * Account-longevity design:
 *   - Fixed gap measured from the last post (survives restarts). After downtime it posts ONE item, never a burst.
 *   - Hard floors in LIMITS (≥30 min gap, ≤12/day). Quiet hours. Category rotation so the feed looks human-curated.
 *   - Send failure → retry in 10 min, drop after 3. Anti-ban risk "high"/"critical" → pause automatically.
 *   - Content is a short summary + original link + source attribution (never a copy of the article).
 * Docs: docs/08-CHANNEL.md
 */
import { fetchFeed as realFetch, type FeedHttp, type RawItem } from './feeds.js';
import { ChannelStore, LIMITS, type QueueItem } from './store.js';
import { formatPost, idOf, inQuiet, localParts, normalizeLink, parseQuiet, titleKey, truncate, type Category } from './text.js';

const COURSE_KEYWORDS = [
  'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'golang', 'rust', 'php', 'sql', 'html', 'css', 'react', 'node', 'django', 'flask', 'angular', 'vue',
  'programming', 'coding', 'developer', 'software', 'web', 'app', 'api', 'git', 'linux', 'bash', 'docker', 'kubernetes', 'devops', 'cloud', 'aws', 'azure', 'gcp',
  'cyber', 'security', 'hacking', 'penetration', 'network', 'cryptography', 'malware', 'forensic', 'ai', 'machine learning', 'deep learning', 'data', 'llm', 'chatgpt',
  'algorithm', 'database', 'excel', 'science', 'physics', 'math', 'statistics', 'robotics', 'electronics', 'arduino', 'iot', 'blockchain',
];

export type TickResult =
  | 'posted' | 'off' | 'no-channel' | 'offline' | 'risk' | 'quiet' | 'wait' | 'day-cap' | 'empty' | 'send-failed' | 'too-soon';

export interface EngineDeps {
  store: ChannelStore;
  send(jid: string, text: string): Promise<boolean>;
  now(): number;
  connected(): boolean;
  riskOk(): boolean;
  fetchFeed?: typeof realFetch;
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

const MIN = 60_000, HOUR = 3_600_000;
const kwRe = (k: string) => new RegExp(`(^|[^a-z0-9+#])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i');
const COURSE_RES = COURSE_KEYWORDS.map(kwRe);
export const isTechCourse = (title: string) => COURSE_RES.some((r) => r.test(title));

export class ChannelEngine {
  private lastManualFetch = 0;
  constructor(private d: EngineDeps) {}
  /** exposed for the command module */
  get d_store() { return this.d.store; }
  private get st() { return this.d.store.s; }
  private log = (m: string) => this.d.log?.info(`[channel] ${m}`);

  // ───────── helpers ─────────
  private maxAge(cat: Category) {
    const s = this.st.settings;
    return (cat === 'course' ? s.courseMaxAgeHours : s.maxAgeHours) * HOUR;
  }
  private fresh(i: QueueItem, now: number) { return now - (i.published || i.addedAt) <= this.maxAge(i.category); }
  postsToday(now = this.d.now()) {
    const tz = this.st.settings.tz, today = localParts(now, tz).day;
    return this.st.history.filter((h) => !h.skipped && localParts(h.at, tz).day === today);
  }
  nextEligibleAt(): number {
    return this.st.lastPostAt ? this.st.lastPostAt + this.st.settings.intervalMin * MIN : 0;
  }

  // ───────── refresh ─────────
  async refresh(manual = false): Promise<{ added: number; errors: string[]; skipped?: string }> {
    const now = this.d.now();
    if (manual && now - this.lastManualFetch < LIMITS.minManualFetchGapMin * MIN) return { added: 0, errors: [], skipped: `wait ${LIMITS.minManualFetchGapMin} min between manual fetches` };
    if (manual) this.lastManualFetch = now;

    const fetchFeed = this.d.fetchFeed ?? realFetch;
    const errors: string[] = [];
    let added = 0;
    const known = new Set([...this.st.history, ...this.st.queue].flatMap((x) => [x.id, x.key]));

    for (const feed of this.st.feeds.filter((x) => x.enabled)) {
      try {
        const http: FeedHttp = { etag: feed.etag, lastModified: feed.lastModified };
        const r = await fetchFeed(feed.url, http);
        feed.fails = 0; feed.etag = r.http.etag; feed.lastModified = r.http.lastModified;
        if (r.notModified) continue;
        const items = [...r.items].sort((a, b) => b.published - a.published).slice(0, LIMITS.perFeedTake);
        for (const raw of items) {
          const q = this.toQueueItem(raw, feed.name, feed.category, now);
          if (!q || known.has(q.id) || known.has(q.key) || !this.fresh(q, now)) continue;
          if (q.category === 'course' && !isTechCourse(q.title)) continue;
          q.approved = !this.st.settings.review;
          this.st.queue.push(q); known.add(q.id); known.add(q.key); added++;
        }
      } catch (err) {
        feed.fails++;
        const msg = `${feed.name}: ${(err as Error).message}`;
        errors.push(msg);
        if (feed.fails >= LIMITS.feedAutoDisableAfter) { feed.enabled = false; errors.push(`${feed.name}: disabled after ${feed.fails} failures`); }
      }
    }

    // prune stale, cap size (drop oldest first)
    this.st.queue = this.st.queue.filter((i) => this.fresh(i, now));
    if (this.st.queue.length > LIMITS.queueCap) {
      this.st.queue.sort((a, b) => (b.published || b.addedAt) - (a.published || a.addedAt));
      this.st.queue.length = LIMITS.queueCap;
    }
    const cutoff = now - 30 * 24 * HOUR;
    this.st.history = this.st.history.filter((h) => h.at >= cutoff);
    this.st.lastFetchAt = now;
    this.d.store.save();
    this.log(`refresh: +${added} queued (${this.st.queue.length} total), ${errors.length} error(s)`);
    return { added, errors };
  }

  private toQueueItem(raw: RawItem, source: string, category: Category, now: number): QueueItem | null {
    const link = normalizeLink(raw.link);
    if (!link || !raw.title) return null;
    return {
      id: idOf(link), key: titleKey(raw.title), title: raw.title, link, summary: truncate(raw.summary, 400),
      source, category, published: raw.published && raw.published <= now + HOUR ? raw.published : 0,
      addedAt: now, approved: true, fails: 0, retryAfter: 0,
    };
  }

  // ───────── tick ─────────
  async tick(opts: { force?: boolean } = {}): Promise<TickResult> {
    const s = this.st.settings, now = this.d.now();
    if (!s.enabled) return 'off';
    if (!s.jid) return 'no-channel';
    if (!this.d.connected()) return 'offline';
    if (!this.d.riskOk()) return 'risk';
    const { hour } = localParts(now, s.tz);
    if (inQuiet(hour, parseQuiet(s.quiet))) return 'quiet';

    const since = now - this.st.lastPostAt;
    if (opts.force) { if (since < LIMITS.minManualGapMin * MIN) return 'too-soon'; }
    else if (since < s.intervalMin * MIN) return 'wait';

    const today = this.postsToday(now);
    if (today.length >= s.maxPerDay) return 'day-cap';
    const coursesToday = today.filter((h) => h.category === 'course').length;

    const cands = this.st.queue
      .filter((i) => (!s.review || i.approved) && i.retryAfter <= now && this.fresh(i, now))
      .filter((i) => i.category !== 'course' || coursesToday < s.courseMaxPerDay)
      .sort((a, b) => (b.published || b.addedAt) - (a.published || a.addedAt));
    if (!cands.length) return 'empty';
    const item = cands.find((i) => i.category !== this.st.lastCategory) ?? cands[0]!;

    const ok = await this.d.send(s.jid, formatPost(item));
    if (ok) {
      this.st.queue = this.st.queue.filter((i) => i.id !== item.id);
      this.st.history.push({ id: item.id, key: item.key, category: item.category, at: now, link: item.link });
      this.st.lastPostAt = now; this.st.lastCategory = item.category;
      this.d.store.save();
      this.log(`posted [${item.category}] ${truncate(item.title, 60)}`);
      return 'posted';
    }
    item.fails++; item.retryAfter = now + LIMITS.retryDelayMin * MIN;
    if (item.fails >= LIMITS.maxSendFails) this.st.queue = this.st.queue.filter((i) => i.id !== item.id);
    this.d.store.save();
    return 'send-failed';
  }
}
