/**
 * @module services/util
 * Small pure helpers shared by modules.
 */
import type { Action } from '../storage/db.js';

/** "on"/"off" (and friends) → boolean, anything else → null */
export function parseToggle(s?: string): boolean | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (['on', 'enable', 'enabled', 'true', 'yes', '1'].includes(v)) return true;
  if (['off', 'disable', 'disabled', 'false', 'no', '0'].includes(v)) return false;
  return null;
}

export function parseAction(s?: string): Action | null {
  const v = s?.toLowerCase();
  return v === 'delete' || v === 'warn' || v === 'kick' ? v : null;
}

export const onOff = (b: boolean) => (b ? '✅ ON' : '❌ OFF');

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}
