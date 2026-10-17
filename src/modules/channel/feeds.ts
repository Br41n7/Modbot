/**
 * @module modules/channel/feeds
 * RSS 2.0 / Atom fetching + parsing (free, no API keys). One HTTP request per feed per refresh,
 * conditional GET (ETag / Last-Modified), 10 s timeout, 2 MB cap, polite User-Agent.
 * Docs: docs/08-CHANNEL.md#sources
 */
import { XMLParser } from 'fast-xml-parser';
import { stripHtml } from './text.js';

export interface RawItem { title: string; link: string; summary: string; published: number }
export interface FeedHttp { etag?: string | undefined; lastModified?: string | undefined }

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true });

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));

function atomLink(l: any): string {
  const links = arr<any>(l);
  const alt = links.find((x) => x?.['@_rel'] === 'alternate') ?? links.find((x) => !x?.['@_rel']) ?? links[0];
  return typeof alt === 'string' ? alt : alt?.['@_href'] ?? '';
}

export function parseFeedXml(xml: string): RawItem[] {
  const doc = parser.parse(xml);
  const out: RawItem[] = [];

  for (const it of arr<any>(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item)) {
    const link = text(it.link) || text(it.guid);
    const date = Date.parse(text(it.pubDate) || text(it['dc:date']));
    out.push({
      title: stripHtml(text(it.title)),
      link: link.trim(),
      summary: stripHtml(text(it.description) || text(it['content:encoded'])),
      published: Number.isFinite(date) ? date : 0,
    });
  }
  for (const en of arr<any>(doc?.feed?.entry)) {
    const date = Date.parse(text(en.published) || text(en.updated));
    out.push({
      title: stripHtml(text(en.title)),
      link: atomLink(en.link).trim(),
      summary: stripHtml(text(en.summary) || text(en.content)),
      published: Number.isFinite(date) ? date : 0,
    });
  }
  return out.filter((i) => i.title && i.link);
}

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export async function fetchFeed(url: string, http: FeedHttp = {}, fetchImpl: FetchLike = fetch as any):
  Promise<{ items: RawItem[]; notModified: boolean; http: FeedHttp }> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; wa-modbot/1.0; +feed-reader)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  };
  if (http.etag) headers['If-None-Match'] = http.etag;
  if (http.lastModified) headers['If-Modified-Since'] = http.lastModified;

  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (res.status === 304) return { items: [], notModified: true, http };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (body.length > 2_000_000) throw new Error('feed too large');
  const items = parseFeedXml(body);
  if (!items.length) throw new Error('no items (not a valid RSS/Atom feed?)');
  return { items, notModified: false, http: { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined } };
}
