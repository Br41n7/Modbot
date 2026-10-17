/**
 * @module core/registry
 * Holds every loaded module's commands + filters. Detects duplicate command names/aliases at startup
 * (fail fast instead of silently shadowing). Used by dispatcher (lookup), policy (feature list) and
 * scripts/gen-docs.ts (auto-generated docs/COMMANDS.md).
 * Docs: docs/04-MODULES.md
 */
import type { BotModule, Command, Filter } from './types.js';

export class Registry {
  readonly modules: BotModule[] = [];
  private byName = new Map<string, Command>();
  readonly commands: Array<Command & { module: string }> = [];
  readonly filters: Array<Filter & { module: string }> = [];

  register(mod: BotModule) {
    this.modules.push(mod);
    for (const cmd of mod.commands ?? []) {
      for (const n of [cmd.name, ...(cmd.aliases ?? [])]) {
        const key = n.toLowerCase();
        if (this.byName.has(key)) throw new Error(`Duplicate command/alias "${key}" (module ${mod.name})`);
        this.byName.set(key, cmd);
      }
      this.commands.push({ ...cmd, module: mod.name });
    }
    for (const f of mod.filters ?? []) this.filters.push({ ...f, module: mod.name });
    this.filters.sort((a, b) => a.priority - b.priority);
  }

  find(name: string): Command | undefined { return this.byName.get(name.toLowerCase()); }
  featureOf(cmd: Command): string { return cmd.feature ?? cmd.name; }

  /** unique feature keys with their default role (strictest wins if commands share a feature) */
  features(): Array<{ feature: string; defaultRole: Command['defaultRole']; locked: boolean; commands: string[] }> {
    const out = new Map<string, { feature: string; defaultRole: Command['defaultRole']; locked: boolean; commands: string[] }>();
    for (const c of this.commands) {
      const f = this.featureOf(c);
      const cur = out.get(f);
      if (!cur) out.set(f, { feature: f, defaultRole: c.defaultRole, locked: !!c.ownerLocked, commands: [c.name] });
      else { cur.commands.push(c.name); cur.locked ||= !!c.ownerLocked; }
    }
    return [...out.values()].sort((a, b) => a.feature.localeCompare(b.feature));
  }
}
