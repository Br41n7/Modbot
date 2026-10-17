/**
 * @module modules/channel/store
 * Persistent state for the channel poster → data/channel.json
 *   settings : everything `.channel ...` can change
 *   feeds    : source list (seeded from DEFAULT_FEEDS on first run)
 *   queue    : fetched items waiting to be posted
 *   history  : what was posted (dedupe + daily caps), pruned to 30 days
 *   lastPostAt / lastCategory : drive the fixed interval and category rotation
 * Docs: docs/08-CHANNEL.md#state
 */
import path from 'node:path';
import { config } from '../../config.js';
import { JsonStore } from '../../storage/jsonStore.js';
import type { Category } from './text.js';

export interface FeedCfg { name: string; url: string; category: Category; enabled: boolean; fails: number; etag?: string | undefined; lastModified?: string | undefined; note?: string }
export interface QueueItem { id: string; key: string; title: string; link: string; summary: string; source: string; category: Category; published: number; addedAt: number; approved: boolean; fails: number; retryAfter: number }
/** `skipped` = removed by the owner (remembered so it never returns, but NOT counted as a post) */
export interface HistoryItem { id: string; key: string; category: Category; at: number; link: string; skipped?: boolean }

export interface ChannelSettings {
  enabled: boolean; jid: string; intervalMin: number; maxPerDay: number; quiet: string; tz: string; review: boolean;
  fetchEveryMin: number; maxAgeHours: number; courseMaxAgeHours: number; courseMaxPerDay: number;
}
export interface ChannelState { settings: ChannelSettings; feeds: FeedCfg[]; queue: QueueItem[]; history: HistoryItem[]; lastPostAt: number; lastFetchAt: number; lastCategory: Category | null }

/** Safety rails: the commands refuse to go beyond these (account longevity). */
export const LIMITS = { minIntervalMin: 30, maxPerDay: 12, minManualGapMin: 10, minManualFetchGapMin: 5, queueCap: 60, perFeedTake: 15, feedAutoDisableAfter: 5, maxSendFails: 3, retryDelayMin: 10 };

const f = (name: string, url: string, category: Category, enabled = true, note?: string): FeedCfg =>
  ({ name, url, category, enabled, fails: 0, ...(note ? { note } : {}) });

/** Well-known public feeds. URLs could not be live-tested from the build sandbox — run `.channel test <n>`. */
export const DEFAULT_FEEDS: FeedCfg[] = [
  f('Ars Technica', 'https://feeds.arstechnica.com/arstechnica/technology-lab', 'tech'),
  f('Hacker News (150+ pts)', 'https://hnrss.org/frontpage?points=150', 'tech'),
  f('TechCrunch', 'https://techcrunch.com/feed/', 'tech'),
  f('BleepingComputer', 'https://www.bleepingcomputer.com/feed/', 'security'),
  f('The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 'security'),
  f('Krebs on Security', 'https://krebsonsecurity.com/feed/', 'security'),
  f('ScienceDaily', 'https://www.sciencedaily.com/rss/top/science.xml', 'science'),
  f('Phys.org', 'https://phys.org/rss-feed/', 'science'),
  f('NASA', 'https://www.nasa.gov/feed/', 'science'),
  f('Cloudflare Blog', 'https://blog.cloudflare.com/rss/', 'blog'),
  f('GitHub Blog', 'https://github.blog/feed/', 'blog'),
  f('Google Security Blog', 'https://feeds.feedburner.com/GoogleOnlineSecurityBlog', 'blog'),
  f('freeCodeCamp News', 'https://www.freecodecamp.org/news/rss/', 'blog'),
  f('Julia Evans', 'https://jvns.ca/atom.xml', 'blog'),
  f('CourseJoiner (Udemy coupons)', 'https://www.coursejoiner.com/feed/', 'course', false,
    'DISABLED: coupon aggregator, URL unverified. Test it, check its terms, then enable.'),
];

export const defaultSettings = (): ChannelSettings => ({ ...config.channel });

export class ChannelStore {
  readonly store: JsonStore<ChannelState>;
  constructor(dir = config.dataDir) {
    this.store = new JsonStore<ChannelState>(path.join(dir, 'channel.json'), {
      settings: defaultSettings(), feeds: structuredClone(DEFAULT_FEEDS), queue: [], history: [], lastPostAt: 0, lastFetchAt: 0, lastCategory: null,
    });
    // pick up settings added in later versions
    this.store.data.settings = { ...defaultSettings(), ...this.store.data.settings };
  }
  get s() { return this.store.data; }
  save() { this.store.save(); }
  flush() { this.store.flush(); }
}
