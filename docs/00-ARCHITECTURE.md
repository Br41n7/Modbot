# 00 · Architecture overview

Read this first. Every other doc zooms into one box of this picture.

```
 WhatsApp ◄──► Baileys socket (raw)  ◄── used for: delete, kick, promote, settings, metadata
                    │  wireAntiban()
                    ▼
            baileys-antiban wrapper (safe) ◄── used for: every CHAT message the bot sends
                    │
   events: messages.upsert / group-participants.update / groups.update
                    ▼
             ┌─────────────┐   buildCtx()      ┌──────────────────────────────┐
             │ Dispatcher  │ ───────────────►  │ Ctx (who, where, role, text) │
             └─────┬───────┘                   └──────────────────────────────┘
   guards ► ban check ► FILTERS (groups only, passive) ► COMMAND (prefix) gate ► run()
                    │
        Registry ◄── Modules (general, groupAdmin, protection, warnings, welcome, owner)
        Policy   ◄── db.global.policy (owner overrides)      Db ◄── data/global.json, data/groups.json
```

## Folder map (one line per file)

| Path | Role |
|---|---|
| `src/index.ts` | entry point |
| `src/config.ts` | `.env` → `config` object |
| `src/core/connection.ts` | boot, login (QR/pairing), reconnect, shutdown |
| `src/core/antibanSetup.ts` | the only place baileys-antiban is attached |
| `src/core/dispatcher.ts` | events → filters → command gate → run |
| `src/core/context.ts` | raw message → `Ctx`; `parseCommand` |
| `src/core/identity.ts` | LID ⇄ phone resolution |
| `src/core/groupCache.ts` | cached group metadata + admin lookup sets |
| `src/core/registry.ts` | holds modules/commands/filters, rejects duplicates |
| `src/core/types.ts` | all shared types (`Command`, `Filter`, `BotModule`, `Ctx`, `Role`) |
| `src/core/jid.ts`, `logger.ts`, `sentIds.ts` | small helpers |
| `src/permissions/roles.ts` | caller → `Role` |
| `src/permissions/policy.ts` | feature → minimum role (owner-editable) |
| `src/storage/jsonStore.ts`, `db.ts` | JSON persistence + schema/defaults |
| `src/services/moderation.ts` | resolveTargets, canAct, kick, warn, enforce, exempt |
| `src/services/send.ts`, `util.ts` | send outside a message context; parsers |
| `src/modules/*/index.ts` | features (see `04-MODULES.md`) |
| `src/modules/protection/filters.ts` | passive filters |
| `src/modules/channel/*` | channel poster: `feeds.ts` RSS, `engine.ts` scheduler logic, `store.ts` state, `index.ts` command |
| `scripts/gen-docs.ts` | regenerates `docs/COMMANDS.md` |
| `tests/` | fake-socket harness + 49 tests |

## Key design decisions (and why)

1. **Two sockets.** Chat messages go through the anti-ban wrapper (human-like delays, rate limits). Moderation actions (delete, kick) use the raw socket so enforcement is instant. Rule: *if it appears as a message in chat → `ctx.reply/send`; if it is an admin action → `env.sock`/`env.participantsUpdate`.*
2. **Tiered, cumulative roles** `user < admin < superadmin < owner` and a per-feature minimum role. One mechanism covers "what superadmins may do" and "what users may do by default" (`02-PERMISSIONS.md`).
3. **Identity by phone number, resolved from LIDs** because WhatsApp now hides numbers behind LIDs; without this the owner check silently fails in groups.
4. **Explicit module list** (`src/modules/index.ts`): adding a feature = new folder + one line. No magic discovery, so TypeScript catches mistakes.
5. **JSON files, not a database**: zero native dependencies (works on Termux/VPS/Windows). Atomic writes. Swap `Db` later if you outgrow it.
6. **Fail closed**: unknown features are owner-only; owner-locked commands can't be re-tiered; the bot refuses to act on itself, the owner, the group creator or equal/higher rank.
