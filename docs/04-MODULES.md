# 04 · Modules: how to add or change features

A **module** (`BotModule`) bundles `commands`, `filters` and/or a `group-participants` handler. All modules are listed in `src/modules/index.ts`.

| Module | Folder | Purpose |
|---|---|---|
| general | `modules/general` | help, ping, whoami, groupinfo |
| groupAdmin | `modules/groupAdmin` | kick, add, promote, demote, mute/unmute, lock/unlock, tagall, hidetag, del, setname, setdesc, link, revoke, setrules, rules, admins |
| protection | `modules/protection` | filters (anti-sticker/type, anti-link, anti-spam, bad words) + their settings commands, `settings`, `disable/enable` |
| warnings | `modules/warnings` | warn, unwarn, warns, resetwarn, mywarns |
| welcome | `modules/welcome` | welcome/goodbye messages |
| owner | `modules/owner` | owner control panel |

Full per-command table: **`docs/COMMANDS.md`** (auto-generated).

## Add a command (5 steps)
1. Pick/create `src/modules/<name>/index.ts`.
2. Add a `Command`:
```ts
const roll: Command = {
  name: 'roll',                 // typed as  .roll
  aliases: ['dice'],
  description: 'Roll a dice.',
  usage: 'roll [sides]',
  defaultRole: 'user',          // minimum role; owner can change it at runtime
  // groupOnly: true, needsBotAdmin: true, ownerLocked: true, feature: 'fun'  (all optional)
  async run(ctx, args) {
    const n = Math.max(2, Number(args[0]) || 6);
    await ctx.reply(`🎲 ${1 + Math.floor(Math.random() * n)}`);
  },
};
export const funModule: BotModule = { name: 'fun', description: 'Games', commands: [roll] };
```
3. Register: add `funModule` to `allModules` in `src/modules/index.ts`.
4. `npm run check && npm test && npm run docs`.
5. (Optional) add a test in `tests/` using `makeEnv()` + `msg()` from `tests/helpers.ts`.

## Add a filter (passive rule)
```ts
export const noCaps: Filter = {
  name: 'nocaps', description: 'Deletes SHOUTING', priority: 50,   // lower runs first
  async run(ctx) {
    if (!ctx.env.db.settings(ctx.chat).nocaps?.enabled || exempt(ctx)) return false;
    if (ctx.text.length > 10 && ctx.text === ctx.text.toUpperCase()) {
      await enforce(ctx, 'delete', 'no shouting', 'No-caps');
      return true;             // true = consumed; stop other filters and commands
    }
    return false;
  },
};
```
Always: check the setting → `exempt(ctx)` → detect → `enforce()`. Add a toggle command and a `GroupSettings` field (see `03-STORAGE.md`).

## React to group events
Implement `onGroupParticipants(env, ev)` on the module (see `modules/welcome`). `ev.action` is `add | remove | promote | demote`.

## Rules of the road
- Send chat text with `ctx.reply` / `ctx.send` / `sendSafe()`. Never call `env.safe.sendMessage` without a 3rd argument (the library crashes) — the helpers already do it right.
- Admin actions: `env.sock.*`, and **`env.participantsUpdate`** for add/remove/promote/demote (never `sock.groupParticipantsUpdate` directly).
- Who is the target? `resolveTargets(ctx, args)` then `canAct(ctx, target)`.
- Never trust names: compare with `norm()` / `findParticipant()`, not string equality on raw JIDs.
- Keep commands thin; put reusable logic in `src/services/`.
