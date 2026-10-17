# 07 · baileys-antiban integration

## What is wired (`core/antibanSetup.ts`)
`wrapSocket(sock, { preset, warmupDays, persist, groupProfiles }, undefined, { legitimacySignals, groupOpGuard })`.

| Setting | Default | Why |
|---|---|---|
| `ANTIBAN_PRESET` | `moderate` | library rate limits/delays |
| `ANTIBAN_WARMUP_DAYS` | `0` | a moderation bot must reply instantly; use `7` for a brand-new number |
| `LEGIT_SIGNALS` | `false` | the library otherwise injects fake typos + correction messages into replies — wrong for a moderation bot |
| `MAX_ADDS_PER_10MIN` / `MAX_KICKS_PER_10MIN` | 3 / 10 | `GroupOperationGuard` ceilings |
| `markOnlineOnConnect` | `false` | less bot-like |
| `cachedGroupMetadata` | our cache | fewer group queries |

## Which socket for what
| Action | Socket |
|---|---|
| reply/send/react (chat messages) | `env.safe` (anti-ban; delays + limits) |
| delete message, group settings, subject/desc, invite code | `env.sock` raw (instant) |
| add / remove member | `env.participantsUpdate` → guarded by library |
| promote / demote | `env.participantsUpdate` → **bypasses** the guard |

## Library quirks found in v4.10.0 (verified by `tests/antiban.test.ts`)
1. `safe.sendMessage(jid, content)` **throws** (`options` undefined → `options.circuitBreaker`). Always pass a 3rd argument. `ctx.reply/send/react` and `sendSafe` do.
2. `groupParticipantsUpdate` guard maps promote/demote to the `add` bucket (3 per 10 min). We keep the original function and use it for promote/demote.
3. Reading the source, `wrapOptions.circuitBreaker` is looked up on the *send* options, so it appears ineffective when set via `wrapSocket`'s 4th argument. Not used here.
The test named **CANARY** fails when a newer version fixes 1 and 2 — then delete the workarounds.

## Install note
`baileys@7.0.0-rc14` is a pre-release, which fails `baileys-antiban`'s `peer baileys >=6` check, hence `.npmrc` → `legacy-peer-deps=true`.

## Candid risk notes
- Unofficial WhatsApp Web automation can get a number banned regardless of middleware; anti-ban lowers risk, it doesn't remove it. Use a number you can afford to lose.
- Low reply volume + deletes/kicks are the safest pattern; mass adds, broadcasts and identical repeated messages are the riskiest. `add` is therefore superadmin-only and rate-capped.
- `.health` shows the library's risk score. If it reaches `high`/`critical`, stop and wait.
- Optional extras not enabled: deaf-session detector (false positives in quiet groups), proxy rotation, stealth browser pool, fleet coordination.
