# 05 · Moderation features

## Filters {#filters}
Run on every group message (not the bot's own), in priority order, before commands.
Exempt (`services/moderation.exempt`): the bot, superadmins, owner, and group admins unless `.exemptadmins off`.

| Prio | Filter | Trigger | Settings command |
|---|---|---|---|
| 10 | `antitype` | sticker (when antisticker on) or any type in `blockedTypes` (`image video audio document contact location poll sticker`) | `.antisticker on/off`, `.blocktype <t>`, `.unblocktype <t>` |
| 20 | `antilink` | `whatsapp` mode: group/channel invite links; `all` mode: any URL/domain; allow-list | `.antilink on/off [whatsapp\|all] [delete\|warn\|kick]`, `.antilink allow/unallow <text>` |
| 30 | `antispam` | > N messages in W seconds per member | `.antispam on/off [N] [W] [action]` |
| 40 | `antibadword` | word-boundary, case/diacritic-insensitive list match | `.antibadword on/off/add/del/list/action` |

### Auto-delete stickers (requested feature)
`.antisticker on` (group admin) → every sticker from a non-exempt member is deleted instantly via the raw socket. `.antisticker off` stops it. Admins are exempt by default; `.exemptadmins off` makes them subject too. The owner can delegate who may toggle it: `.userfeatures add antisticker` (everyone) or `.superfeatures add antisticker`.

### Enforcement (`enforce(ctx, action, reason, filterName)`)
1. Bot not admin → cannot delete: tells the group once per 30 min, does nothing else.
2. `delete` → delete only. `warn` → delete + warning (auto-kick at limit). `kick` → delete + remove.

## Warnings {#warnings}
Counters per group in `groups.json`. `.warn @u [reason]`, `.unwarn`, `.resetwarn`, `.warns [@u]`, `.mywarns`, limit via `.warnlimit 1-10` (default 3). At the limit the member is removed and the counter reset. Filters with action `warn` use the same counters.

## Group admin commands {#group-admin-commands}
Targets: @mention, reply to a message, or a typed number (mapped to the group's participant id, LID-safe). Rules in `canAct`. `kick/promote/demote/mute/unmute/lock/unlock/setname/setdesc/link/revoke/del` require the bot to be admin. `add` is **superadmin** by default because mass-adding is a major ban trigger; it is also capped by `MAX_ADDS_PER_10MIN`.

## Welcome / goodbye {#welcome}
`.welcome on`, `.goodbye on`, `.setwelcome <text>`, `.setgoodbye <text>`. Placeholders `{user}` (mentions), `{group}`, `{rules}`, `{count}`.

## Services (`src/services/moderation.ts`)
`resolveTargets`, `senderTarget`, `canAct`, `kickParticipant` (checks WhatsApp's per-user status), `addWarning`, `noteBotNotAdmin`, `exempt`, `enforce`.
