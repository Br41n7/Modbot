/**
 * @module permissions/policy
 * Decides "may role R use feature F?".
 *
 *   effectiveRole(F) = db.policy[F]  (owner override)  ??  command.defaultRole
 *   can(F, R)        = rank(R) >= rank(effectiveRole(F))
 *
 * Tiers are CUMULATIVE:  user < admin < superadmin < owner.
 *   - "user features"       = features whose effective role is `user`   (everyone)
 *   - "admin features"      = effective role `admin`  (WhatsApp group admins, superadmins, owner)
 *   - "superadmin features" = effective role `superadmin` (superadmins + owner)
 *   - everything else       = owner only
 * `ownerLocked` features can never be lowered at runtime (safety).
 * Docs: docs/02-PERMISSIONS.md#policy
 */
import type { Db } from '../storage/db.js';
import type { Registry } from '../core/registry.js';
import { ROLE_RANK, type Role } from '../core/types.js';

export class Policy {
  constructor(private db: Db, private registry: Registry) {}

  private meta(feature: string) {
    return this.registry.features().find((f) => f.feature === feature);
  }

  exists(feature: string) { return !!this.meta(feature); }

  effectiveRole(feature: string): Role {
    const m = this.meta(feature);
    if (!m) return 'owner'; // unknown features are owner-only (fail closed)
    if (m.locked) return m.defaultRole;
    return this.db.global.data.policy[feature] ?? m.defaultRole;
  }

  can(feature: string, role: Role): boolean {
    return ROLE_RANK[role] >= ROLE_RANK[this.effectiveRole(feature)];
  }

  set(feature: string, role: Role): { ok: true } | { ok: false; error: string } {
    const m = this.meta(feature);
    if (!m) return { ok: false, error: `Unknown feature "${feature}". See .perms` };
    if (m.locked) return { ok: false, error: `"${feature}" is owner-locked and cannot be changed.` };
    if (role === m.defaultRole) delete this.db.global.data.policy[feature];
    else this.db.global.data.policy[feature] = role;
    this.db.saveGlobal();
    return { ok: true };
  }

  reset(feature: string) {
    delete this.db.global.data.policy[feature];
    this.db.saveGlobal();
  }

  /** features grouped by effective role */
  tiers(): Record<Role, string[]> {
    const t: Record<Role, string[]> = { user: [], admin: [], superadmin: [], owner: [] };
    for (const f of this.registry.features()) t[this.effectiveRole(f.feature)].push(f.feature);
    return t;
  }
}
