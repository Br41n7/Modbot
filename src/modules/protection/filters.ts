/**
 * @module modules/protection/filters
 * Passive per-group protections. Each filter: (1) is the setting on? (2) is the sender exempt?
 * (3) violation? → enforce(). Return true = message consumed (stops later filters + commands).
 *
 *  prio 10 antitype    auto-delete message types: sticker (antisticker) + blockedTypes list
 *  prio 20 antilink    WhatsApp invites (mode whatsapp) or any link (mode all); allow-list supported
 *  prio 30 antispam    flood: > max messages in windowSec per user
 *  prio 40 antibadword banned-word list (word-boundary, case/diacritic-insensitive)
 * Docs: docs/05-MODERATION.md#filters
 */
import type { Ctx, Filter } from '../../core/types.js';
import { enforce, exempt } from '../../services/moderation.js';

/** friendly type name → Baileys content types */
export const TYPE_MAP: Record<string, string[]> = {
  sticker: ['stickerMessage'],
  image: ['imageMessage'],
  video: ['videoMessage'],
  audio: ['audioMessage'],
  document: ['documentMessage'],
  contact: ['contactMessage', 'contactsArrayMessage'],
  location: ['locationMessage', 'liveLocationMessage'],
  poll: ['pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3'],
};

const typeOfName = (ctxType: string): string | null => {
  for (const [name, types] of Object.entries(TYPE_MAP)) if (types.includes(ctxType)) return name;
  return null;
};

export const antiType: Filter = {
  name: 'antitype',
  description: 'Deletes stickers (when .antisticker is on) and any message types in the group\'s blocked list.',
  priority: 10,
  async run(ctx) {
    const s = ctx.env.db.settings(ctx.chat);
    const kind = typeOfName(ctx.type);
    if (!kind) return false;
    const blocked = (kind === 'sticker' && s.antisticker.enabled) || s.blockedTypes.includes(kind);
    if (!blocked || exempt(ctx)) return false;
    await enforce(ctx, 'delete', `${kind}s are not allowed here`, kind === 'sticker' ? 'Anti-sticker' : 'Type blocking');
    return true;
  },
};

const WA_INVITE = /(?:chat\.whatsapp\.com\/[A-Za-z0-9]{10,}|whatsapp\.com\/channel\/[A-Za-z0-9]+)/gi;
const ANY_LINK = new RegExp(
  [
    String.raw`\b(?:https?:\/\/|www\.)[^\s]+`,
    String.raw`\b(?:chat\.whatsapp\.com|wa\.me|t\.me)\/\S+`,
    String.raw`\b[a-z0-9-]{2,}\.(?:com|net|org|io|co|me|ly|gg|xyz|info|biz|app|dev|link|site|online|club|top|vip|ng|us|uk|tv|cc|ws|to|sh)(?:\/\S*)?(?=$|[\s,.;!?)])`,
  ].join('|'),
  'gi',
);

export function findViolatingLinks(text: string, mode: 'whatsapp' | 'all', allow: string[]): string[] {
  const re = mode === 'all' ? ANY_LINK : WA_INVITE;
  re.lastIndex = 0;
  const hits = text.match(re) ?? [];
  const allowed = allow.map((a) => a.toLowerCase());
  return hits.filter((h) => !allowed.some((a) => h.toLowerCase().includes(a)));
}

export const antiLink: Filter = {
  name: 'antilink',
  description: 'Removes WhatsApp invite links (or all links) from non-exempt members; allow-list supported.',
  priority: 20,
  async run(ctx) {
    const s = ctx.env.db.settings(ctx.chat).antilink;
    if (!s.enabled || !ctx.text || exempt(ctx)) return false;
    const bad = findViolatingLinks(ctx.text, s.mode, s.allow);
    if (!bad.length) return false;
    await enforce(ctx, s.action, 'links are not allowed', 'Anti-link');
    return true;
  },
};

const hits = new Map<string, number[]>();
export const resetSpamState = () => hits.clear(); // tests

export const antiSpam: Filter = {
  name: 'antispam',
  description: 'Flood control: more than N messages in W seconds per member triggers the configured action.',
  priority: 30,
  async run(ctx) {
    const s = ctx.env.db.settings(ctx.chat).antispam;
    if (!s.enabled || exempt(ctx)) return false;
    const key = `${ctx.chat}|${ctx.sender}`;
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < s.windowSec * 1000);
    arr.push(now);
    if (arr.length <= s.max) { hits.set(key, arr); return false; }
    hits.delete(key);
    await enforce(ctx, s.action, 'slow down — message flooding', 'Anti-spam');
    return true;
  },
};

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map<string, RegExp | null>();

export function badWordRegex(words: string[]): RegExp | null {
  const key = words.join('\u0000');
  if (cache.has(key)) return cache.get(key)!;
  const re = words.length
    ? new RegExp(`(^|[^\\p{L}\\p{N}])(?:${words.map((w) => esc(norm(w))).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu')
    : null;
  cache.set(key, re);
  return re;
}

export const antiBadword: Filter = {
  name: 'antibadword',
  description: 'Deletes messages containing words from the group\'s banned-word list.',
  priority: 40,
  async run(ctx) {
    const s = ctx.env.db.settings(ctx.chat).antibadword;
    if (!s.enabled || !s.words.length || !ctx.text || exempt(ctx)) return false;
    const re = badWordRegex(s.words);
    if (!re || !re.test(norm(ctx.text))) return false;
    await enforce(ctx, s.action, 'watch your language', 'Bad-word filter');
    return true;
  },
};
