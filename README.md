# wa-modbot — modular WhatsApp group moderation bot

Built on [Baileys](https://github.com/WhiskeySockets/Baileys) + [baileys-antiban](https://github.com/kobie3717/baileys-antiban). TypeScript, no database server, no native deps.

**Highlights:** group moderation & admin tools · auto-delete stickers (and other types) when an admin enables it · anti-link / anti-spam / bad-word filters · warnings with auto-kick · welcome/goodbye · **owner → superadmin → admin → user** roles where the owner decides what each tier may do · LID-safe identity · modular + documented.

## Quick start
```bash
npm install                # .npmrc already sets legacy-peer-deps (baileys 7 is a pre-release)
cp .env.example .env       # set OWNER_NUMBERS=<your number, digits only>
npm start                  # scan the QR  (or set PAIRING_NUMBER for a pairing code)
```
Node ≥ 20. Then in WhatsApp (from the owner number): `.whoami` → must say `owner`; `.help`.
Add the bot to a group and **make it admin** (needed to delete/kick).

## Most useful commands
| Who | Commands |
|---|---|
| everyone | `.help` `.rules` `.admins` `.mywarns` `.ping` `.whoami` |
| group admins | `.antisticker on` `.antilink on` `.antispam on` `.antibadword on` `.kick` `.warn` `.mute` `.unmute` `.tagall` `.del` `.settings` |
| owner | `.addsuper` `.superfeatures add <cmd>` `.userfeatures add <cmd>` `.setrole` `.perms` `.ban` `.mode` `.health` |

Full list: [docs/COMMANDS.md](docs/COMMANDS.md).

## Scripts
`npm start` · `npm run dev` (watch) · `npm run check` (types) · `npm test` · `npm run docs` (regenerate COMMANDS.md) · `npm run build` + `npm run start:prod`

## Docs
| | |
|---|---|
| [00 Architecture](docs/00-ARCHITECTURE.md) | big picture, folder map, decisions |
| [01 Core](docs/01-CORE.md) | each core file |
| [02 Permissions](docs/02-PERMISSIONS.md) | roles, LIDs, policy |
| [03 Storage](docs/03-STORAGE.md) | JSON schema |
| [04 Modules](docs/04-MODULES.md) | add commands/filters |
| [05 Moderation](docs/05-MODERATION.md) | every protection |
| [06 Owner guide](docs/06-OWNER-ADMIN.md) | owner recipes |
| [07 Anti-ban](docs/07-ANTIBAN-INTEGRATION.md) | integration + library quirks + risks |
| [HANDOFF](docs/HANDOFF.md) | status & how to resume |

## Troubleshooting
- **Owner is "user"** → `.whoami`, copy `OWNER_LIDS=` into `.env`.
- **Filters do nothing** → bot isn't group admin (`.settings` shows it).
- **Logged out** → delete `data/auth`, restart, re-link.
- **Keep it running** → `pm2 start "npm start" --name modbot` (VPS) or `tmux`/Termux.

⚠️ Unofficial WhatsApp automation can lead to account bans. Use a number you can afford to lose and read docs/07.
# Modbot
