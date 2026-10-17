/**
 * @module core/types
 * Every shared type lives here. If you add a new kind of extension point, define it here first.
 * Docs: docs/01-CORE.md#types , docs/04-MODULES.md
 */
import type { WASocket, WAMessage, WAMessageKey, GroupMetadata, GroupParticipant } from 'baileys';
import type { Config } from '../config.js';
import type { Db } from '../storage/db.js';
import type { GroupCache } from './groupCache.js';
import type { Identity } from './identity.js';
import type { Registry } from './registry.js';
import type { Policy } from '../permissions/policy.js';
import type { SentIds } from './sentIds.js';

// ───────── roles ─────────
export type Role = 'user' | 'admin' | 'superadmin' | 'owner';
export const ROLES: Role[] = ['user', 'admin', 'superadmin', 'owner'];
export const ROLE_RANK: Record<Role, number> = { user: 0, admin: 1, superadmin: 2, owner: 3 };
export const isRole = (s: string): s is Role => (ROLES as string[]).includes(s);

// ───────── group info (cached metadata + precomputed lookup sets) ─────────
export interface GroupInfo {
  meta: GroupMetadata;
  /** normalized jids (PN and LID forms) of every group admin */
  adminKeys: Set<string>;
  /** normalized jids of the group creator / superadmin(s) */
  superKeys: Set<string>;
  /** normalized jid (any form) → participant */
  byKey: Map<string, GroupParticipant>;
  botIsAdmin: boolean;
  fetchedAt: number;
}

// ───────── environment shared by everything ─────────
export interface BotEnv {
  /** raw Baileys socket — use for NON-chat actions (delete, kick, settings, metadata) */
  sock: WASocket;
  /** baileys-antiban wrapped socket — use for every chat message the bot SENDS */
  safe: WASocket;
  db: Db;
  groups: GroupCache;
  identity: Identity;
  registry: Registry;
  policy: Policy;
  sent: SentIds;
  /**
   * Group participant changes. add/remove go through baileys-antiban's rate guard;
   * promote/demote BYPASS it (the library wrongly counts them as "add" — see docs/07-ANTIBAN-INTEGRATION.md).
   */
  participantsUpdate(jid: string, ids: string[], action: 'add' | 'remove' | 'promote' | 'demote'): Promise<any>;
  config: Config;
  startedAt: number;
}

export interface QuotedInfo {
  /** key usable with { delete: key } */
  key: WAMessageKey;
  /** jid of the quoted message author (as WhatsApp gave it) */
  sender: string;
  message: unknown;
}

// ───────── message context handed to commands & filters ─────────
export interface Ctx {
  env: BotEnv;
  msg: WAMessage;
  chat: string;
  isGroup: boolean;
  fromMe: boolean;
  sender: string;
  senderPn: string | null;
  senderName: string;
  role: Role;
  text: string;
  /** Baileys content type: conversation, extendedTextMessage, imageMessage, stickerMessage, ... */
  type: string;
  mentioned: string[];
  quoted: QuotedInfo | null;
  group: GroupInfo | null;
  prefix: string;
  reply(text: string, mentions?: string[]): Promise<void>;
  send(text: string, mentions?: string[]): Promise<void>;
  react(emoji: string): Promise<void>;
  /** delete a message in this chat (default: the current one). Uses the RAW socket (no anti-ban delay). */
  deleteMsg(key?: WAMessageKey): Promise<boolean>;
}

// ───────── extension points ─────────
export interface Command {
  name: string;
  aliases?: string[];
  /** permission key; defaults to `name`. Several commands may share one feature. */
  feature?: string;
  description: string;
  usage?: string;
  /** minimum role by default; the owner can change it at runtime with .setrole */
  defaultRole: Role;
  /** true = role can never be changed at runtime (dangerous owner tools) */
  ownerLocked?: boolean;
  groupOnly?: boolean;
  privateOnly?: boolean;
  /** refuse early with a friendly message if the bot is not a group admin */
  needsBotAdmin?: boolean;
  run(ctx: Ctx, args: string[], rawArgs: string): Promise<void>;
}

/** Passive moderation rule that sees EVERY group message before commands. Return true = message handled, stop. */
export interface Filter {
  name: string;
  description: string;
  /** lower runs first */
  priority: number;
  run(ctx: Ctx): Promise<boolean>;
}

export interface GroupParticipantsEvent {
  id: string;
  author?: string;
  participants: GroupParticipant[];
  action: 'add' | 'remove' | 'promote' | 'demote' | 'modify';
}

export interface BotModule {
  name: string;
  description: string;
  commands?: Command[];
  filters?: Filter[];
  onGroupParticipants?(env: BotEnv, ev: GroupParticipantsEvent): Promise<void>;
}
