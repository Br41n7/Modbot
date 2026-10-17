/**
 * @module storage/db
 * The bot's whole database = two JSON files in DATA_DIR:
 *   global.json : prefix, mode, superadmins, bans, feature-role overrides, LID→PN map
 *   groups.json : per-group settings + warning counters
 * Anything new a module wants to persist per-group → add a field to GroupSettings
 * (defaults auto-merge into old files, no migration needed).
 * Docs: docs/03-STORAGE.md
 */
import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import type { Role } from '../core/types.js';

export type Action = 'delete' | 'warn' | 'kick';

export interface GlobalData {
  prefix: string | null;                          // null = use config.prefix
  mode: 'public' | 'private';                     // private = only owner/superadmins may run commands
  superadmins: string[];                          // phone numbers (digits)
  banned: Record<string, { reason: string; by: string; at: number }>; // key = digits or lid user
  policy: Record<string, Role>;                   // feature → minimum role override
  lidMap: Record<string, string>;                 // lid user part → phone digits
}

export interface GroupSettings {
  exemptAdmins: boolean;                          // group admins immune to filters
  maxWarns: number;
  rules: string;
  disabled: string[];                             // features switched off in this group
  antilink: { enabled: boolean; mode: 'whatsapp' | 'all'; action: Action; allow: string[] };
  antisticker: { enabled: boolean };
  blockedTypes: string[];                         // message types auto-deleted (image, video, ...)
  antispam: { enabled: boolean; max: number; windowSec: number; action: Action };
  antibadword: { enabled: boolean; words: string[]; action: Action };
  welcome: { enabled: boolean; text: string };
  goodbye: { enabled: boolean; text: string };
}

export interface WarnRecord { count: number; reasons: string[]; updated: number }
export interface GroupData { settings: GroupSettings; warns: Record<string, WarnRecord> }

export const defaultGroupSettings = (): GroupSettings => ({
  exemptAdmins: true,
  maxWarns: 3,
  rules: '',
  disabled: [],
  antilink: { enabled: false, mode: 'whatsapp', action: 'delete', allow: [] },
  antisticker: { enabled: false },
  blockedTypes: [],
  antispam: { enabled: false, max: 7, windowSec: 10, action: 'delete' },
  antibadword: { enabled: false, words: [], action: 'delete' },
  welcome: { enabled: false, text: 'Welcome {user} to *{group}* 👋\n{rules}' },
  goodbye: { enabled: false, text: 'Goodbye {user} 👋' },
});

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fill any missing keys of `target` from `defaults` (recursively); arrays/scalars are kept as stored. */
export function fillDefaults<T>(target: any, defaults: T): T {
  for (const [k, dv] of Object.entries(defaults as object)) {
    if (!(k in target)) target[k] = structuredClone(dv);
    else if (isObj(dv) && isObj(target[k])) fillDefaults(target[k], dv);
  }
  return target;
}

export class Db {
  readonly global: JsonStore<GlobalData>;
  readonly groups: JsonStore<Record<string, GroupData>>;

  constructor(dir: string) {
    this.global = new JsonStore<GlobalData>(path.join(dir, 'global.json'), {
      prefix: null, mode: 'public', superadmins: [], banned: {}, policy: {}, lidMap: {},
    });
    this.groups = new JsonStore<Record<string, GroupData>>(path.join(dir, 'groups.json'), {});
  }

  /** Get (and create if missing) a group's data. Mutate it, then call saveGroups(). */
  group(jid: string): GroupData {
    const g = (this.groups.data[jid] ??= { settings: defaultGroupSettings(), warns: {} });
    fillDefaults(g.settings, defaultGroupSettings());
    return g;
  }
  settings(jid: string): GroupSettings { return this.group(jid).settings; }

  saveGlobal() { this.global.save(); }
  saveGroups() { this.groups.save(); }
  flush() { this.global.flush(); this.groups.flush(); }
}
