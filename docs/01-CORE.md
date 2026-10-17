# 01 · Core internals

## config  (`src/config.ts`)
Reads `.env` once into a plain mutable `config` object (tests mutate it). All env vars are listed in `.env.example`. Add a setting = add a line here + `.env.example`.

## logger  (`core/logger.ts`)
`makeLog('scope')` for our code; `baileysLog` (pino, silent unless `LOG_LEVEL=debug`) for Baileys. Levels: silent < error < warn < info < debug.

## types  (`core/types.ts`)
Single source of truth: `Role`, `ROLE_RANK`, `GroupInfo`, `BotEnv`, `Ctx`, `Command`, `Filter`, `BotModule`, `GroupParticipantsEvent`.
`BotEnv` = everything shared: `sock` (raw), `safe` (anti-ban), `db`, `groups`, `identity`, `registry`, `policy`, `sent`, `participantsUpdate`, `config`.

## jid  (`core/jid.ts`)
`norm()` strips device suffix (`123:5@…` → `123@…`). Always compare normalized JIDs. `isLid/isPn/userPart/pnJid/at`.

## identity  (`core/identity.ts`)
`pnOf(jid, sock, hints)` → phone digits or `null`. Order: persisted map → hints (message `participantAlt`, participant `phoneNumber`) → `sock.signalRepository.lidMapping.getPNForLID`. Every success is learned and saved in `db.global.lidMap`.
`keyOf()` gives the stable key used for warns/bans (phone digits, else normalized jid).

## group cache  (`core/groupCache.ts`)
`get(sock, jid)` returns `GroupInfo` (metadata + `adminKeys`, `superKeys`, `byKey`, `botIsAdmin`), cached 5 min, stale copy on fetch failure. Admin sets contain **both** PN and LID forms of every admin, so `isAdminIn(group, anyJid)` works whichever form arrives. Invalidated by dispatcher on participant/group updates and by commands that change the group. Also feeds Baileys `cachedGroupMetadata` (fewer metadata queries).

## registry  (`core/registry.ts`)
`register(module)`; throws on duplicate command names/aliases. `features()` groups commands by `feature` key (default = command name). Commands sharing a feature share one permission (e.g. `blocktype`/`unblocktype`).

## context  (`core/context.ts`)
`buildCtx(env, msg)`:
- chat/sender (own jid when `fromMe`), `senderPn` via identity, group info, **role**, text/type (`normalizeMessageContent` unwraps ephemeral/view-once), mentions, quoted info (deletable key).
- helpers: `reply` (quotes), `send`, `react` → anti-ban socket **with an options object always**; `deleteMsg` → raw socket.
`parseCommand(text, prefix)` → `{name,args,raw}`; `". help"` (space after prefix) is not a command.

## dispatcher  (`core/dispatcher.ts`)
Pipeline per message: ignore own echoes (`SentIds`) → dedupe by id → ignore messages older than `MAX_MESSAGE_AGE_SEC` → ignore protocol/reaction → `buildCtx` → ignore own-phone messages in other people's DMs → global-ban check → **filters** (groups, not fromMe, by priority; first to return `true` stops everything) → **command gate**:

`mode private?` → `groupOnly/privateOnly` → `group-disabled?` → `cooldown` (not owner) → `policy.can` → `needsBotAdmin` → `run()` in try/catch.

Also handles `group-participants.update` (cache invalidation, learn LID↔PN, call `module.onGroupParticipants`) and `groups.update`.
Debug tip: set `LOG_LEVEL=debug`; crashes in commands/filters are logged with the command/filter name and the user gets a generic error.

## connection  (`core/connection.ts`)
`startBot()` builds singletons once, then `connectOnce()` per (re)connect: Baileys socket → `wireAntiban` → set `env.sock/safe/participantsUpdate` → `dispatcher.attach`.
Login: QR in terminal, or pairing code if `PAIRING_NUMBER` set and not registered. Reconnect: exponential backoff ≤ 60 s, immediate on `restartRequired`. Exits (on purpose) on logged-out (401) and replaced (440). SIGINT/SIGTERM flush data.

## sentIds  (`core/sentIds.ts`)
Bounded set of ids the bot sent; also used as the dispatcher's dedupe set.
