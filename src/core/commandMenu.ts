/**
 * Shared policy-aware neon command grid used by .help/.menu, .neon and .help <command>.
 *
 * Two tiers so this stays readable as modules/commands grow:
 *   buildMenuOverview(ctx)         -> categories + counts only (what `.menu` shows by default)
 *   buildModuleMenu(ctx, module)   -> full command table for ONE category (`.menu <category>`)
 * Printing every command from every module in one message (the old behaviour) doesn't scale:
 * it gets unreadable and can run into WhatsApp's per-message length limits once you have more
 * than a handful of modules.
 */
import type { Ctx } from './types.js';
import { ROLE_RANK } from './types.js';

const SECTIONS: Record<string, { title: string; icon: string }> = {
  general: { title: 'GENERAL', icon: '📖' },
  arcade: { title: 'ARCADE & FUN', icon: '⚡' },
  groupAdmin: { title: 'GROUP ADMIN', icon: '🛡️' },
  protection: { title: 'PROTECTION', icon: '🧱' },
  warnings: { title: 'WARNINGS', icon: '⚠️' },
  welcome: { title: 'WELCOME', icon: '👋' },
  owner: { title: 'OWNER CONTROL', icon: '👑' },
  channel: { title: 'CHANNEL', icon: '📡' },
};

const clean = (value: string, max: number) => {
  const oneLine = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
};

const sectionFor = (module: string) =>
  SECTIONS[module] ?? { title: module.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(), icon: '•' };

/** a-z0-9 only, for forgiving category matching (ignores spaces, &, case) */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type VisibleCommand = Ctx['env']['registry']['commands'][number];

/** Commands the caller may currently use (role, group scope, disabled features), grouped by module. */
function visibleByModule(ctx: Ctx): Map<string, VisibleCommand[]> {
  const { registry, policy, db } = ctx.env;
  const disabled = ctx.isGroup ? db.settings(ctx.chat).disabled : [];
  const byModule = new Map<string, VisibleCommand[]>();

  for (const command of registry.commands) {
    const feature = registry.featureOf(command);
    if (!policy.can(feature, ctx.role)) continue;
    if (disabled.includes(feature) && ROLE_RANK[ctx.role] < ROLE_RANK.superadmin) continue;
    if (command.groupOnly && !ctx.isGroup) continue;
    if (command.privateOnly && ctx.isGroup) continue;
    const list = byModule.get(command.module) ?? [];
    list.push(command);
    byModule.set(command.module, list);
  }
  return byModule;
}

const header = (ctx: Ctx, suffix: string) => [
  `╭━━━〔 ⚡ ${clean(ctx.env.config.botName.toUpperCase(), 24)} • ${suffix} ⚡ 〕━━━╮`,
  `│ PREFIX: ${ctx.prefix}  •  ROLE: ${ctx.role.toUpperCase()}`,
];

const footer = '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯';

/** Category list with counts only — safe to call as modules/commands grow without ballooning. */
export function buildMenuOverview(ctx: Ctx): string {
  const byModule = visibleByModule(ctx);
  const totalCommands = [...byModule.values()].reduce((n, list) => n + list.length, 0);

  const lines = header(ctx, 'COMMAND GRID');
  lines.push(`│ ${byModule.size} categories • ${totalCommands} commands available to you`);
  lines.push('├────────────────────────────');

  const nameWidth = Math.max(...[...byModule.keys()].map((m) => sectionFor(m).title.length), 10);
  for (const [module, commands] of byModule) {
    const section = sectionFor(module);
    lines.push(`│ ${section.icon} ${section.title.padEnd(nameWidth)}  (${commands.length})`);
  }

  lines.push(footer);
  lines.push(`◇ ${ctx.prefix}menu <category> for commands  •  ${ctx.prefix}help <command> for details`);
  return lines.join('\n');
}

/** Resolve a user-typed category name against module keys and titles (case/space/& insensitive, prefix OK). */
export function resolveModule(ctx: Ctx, input: string): string | undefined {
  const byModule = visibleByModule(ctx);
  const target = slug(input);
  if (!target) return undefined;

  for (const module of byModule.keys()) {
    if (slug(module) === target || slug(sectionFor(module).title) === target) return module;
  }
  for (const module of byModule.keys()) {
    if (slug(module).startsWith(target) || slug(sectionFor(module).title).startsWith(target)) return module;
  }
  return undefined;
}

/** Full command table for one category. Caller should resolve `module` with resolveModule() first. */
export function buildModuleMenu(ctx: Ctx, module: string): string {
  const commands = visibleByModule(ctx).get(module) ?? [];
  const section = sectionFor(module);

  const lines = header(ctx, `${section.title} ⚡`);
  lines.push(`│ ${commands.length} command${commands.length === 1 ? '' : 's'} available to you here`);
  lines.push('├────────────────────────────');
  lines.push('│ COMMAND       ALIASES      DESCRIPTION');
  for (const command of commands) {
    const name = clean(`${ctx.prefix}${command.name}`, 13).padEnd(13);
    const aliases = clean((command.aliases ?? []).join(',') || '—', 11).padEnd(11);
    const scope = command.groupOnly ? '[GRP] ' : command.privateOnly ? '[DM]  ' : '';
    const description = clean(command.description, 31);
    lines.push(`│ ${name} ${aliases} ${scope}${description}`);
  }

  lines.push(footer);
  lines.push(`◇ Details: ${ctx.prefix}help <command>  •  Back to categories: ${ctx.prefix}menu`);
  return lines.join('\n');
}

/** Back-compat for any other call site that just wants "the menu" — now the overview. */
export function buildNeonCommandMenu(ctx: Ctx): string {
  return buildMenuOverview(ctx);
}
