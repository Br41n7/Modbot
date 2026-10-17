/**
 * @module modules/channel/text
 * Pure text helpers: HTML → plain text, truncation, link normalization, dedupe keys, post formatting.
 * Docs: docs/08-CHANNEL.md#formatting
 */
import { createHash } from 'node:crypto';

export type Category = 'tech' | 'science' | 'security' | 'blog' | 'course';
export const CATEGORIES: Category[] = ['tech', 'science', 'security', 'blog', 'course'];
export const EMOJI: Record<Category, string> = { tech: '💻', science: '🔬', security: '🔐', blog: '✍️', course: '🎓' };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!-]+$/, '') + '…';
}

/** drop tracking params + fragment so the same article from two feeds dedupes */
export function normalizeLink(link: string): string | null {
  try {
    const u = new URL(link.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return null; }
}

export const idOf = (link: string) => createHash('sha1').update(link).digest('hex').slice(0, 16);

/** first 10 normalized words — catches the same story under slightly different URLs */
export const titleKey = (title: string) =>
  title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 10).join(' ');

export interface PostLike { title: string; summary: string; link: string; source: string; category: Category }

/** Plain text, no formatting surprises: emoji + bold title, short summary, link, attribution. */
export function formatPost(p: PostLike): string {
  const title = truncate(p.title.replace(/[*_~`]/g, ''), 140);
  const summary = p.summary ? truncate(p.summary, 260) : '';
  return [`${EMOJI[p.category]} *${title}*`, summary, `🔗 ${p.link}`, `— ${p.source}`].filter(Boolean).join('\n\n');
}

/** Local calendar parts in an IANA time zone (no dependencies). */
export function localParts(ts: number, tz: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts));
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

/** "23-6" → {from:23,to:6}; '' / 'off' → null */
export function parseQuiet(s: string): { from: number; to: number } | null {
  const m = s.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  return from <= 23 && to <= 23 && from !== to ? { from, to } : null;
}

export const inQuiet = (hour: number, q: { from: number; to: number } | null) =>
  !!q && (q.from > q.to ? hour >= q.from || hour < q.to : hour >= q.from && hour < q.to);
