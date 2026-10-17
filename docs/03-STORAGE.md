# 03 · Storage

Two JSON files in `DATA_DIR` (default `./data`) plus the WhatsApp session in `AUTH_DIR`.

| File | Contents |
|---|---|
| `global.json` | `prefix`, `mode` (public/private), `superadmins[]`, `banned{}`, `policy{feature→role}`, `lidMap{}` |
| `groups.json` | `{ [groupJid]: { settings: GroupSettings, warns: { [userKey]: {count, reasons[], updated} } } }` |
| `antiban-state.json` | written by baileys-antiban (warm-up/rate state) |
| `auth/` | **Baileys session = your WhatsApp login. Never share or commit it.** |

## How writes work (`storage/jsonStore.ts`)
`store.save()` → debounced 300 ms → atomic write (tmp + rename). `flush()` writes immediately (on shutdown). A corrupt file is renamed `*.corrupt-<time>` and defaults are used.

## Adding a per-group setting
1. Add the field to `GroupSettings` **and** `defaultGroupSettings()` in `storage/db.ts`.
2. Read with `ctx.env.db.settings(chat).myField`; after changing call `ctx.env.db.saveGroups()`.
Old `groups.json` files get the new default automatically (`fillDefaults`), no migration.

## Backups
Copy `data/` regularly (not `auth/` unless you trust the destination). To reset a group: delete its key from `groups.json` while the bot is stopped.
