# HANDOFF — resume work here (human or AI)

Use this file when a session timed out or someone new picks the project up.

## Status
**Built & passing** (`npm run check` clean, `npm test` 49/49):
- Core: connection (QR/pairing, backoff), dispatcher pipeline, identity (LID↔phone), group cache, registry, policy, JSON storage.
- Roles: owner / superadmin / admin / user; owner-editable feature tiers.
- Moderation: anti-sticker, type blocking, anti-link, anti-spam, bad words, warnings, kick/add/promote/demote, mute/lock, tagall/hidetag, del, link/revoke, rules, welcome/goodbye.
- Owner panel: addsuper/delsuper, ban, setrole, superfeatures/userfeatures, mode, setprefix, health, groups, leave, shutdown.
- Channel auto-poster (`docs/08-CHANNEL.md`): RSS/Atom feeds, fixed interval, daily caps, quiet hours, dedupe, review mode, `.channel` control command.
- baileys-antiban wired with two library bugs worked around and canary-tested.

**NOT verified:** a live WhatsApp session, and any real feed URL (sandbox had no internet). Channel posting to a real `@newsletter` is also unverified. The sandbox had no WhatsApp network, so tests use a fake socket shaped like Baileys 7.0.0-rc14 (LID groups, `participantAlt`). Boot, reconnect/backoff and shutdown were smoke-tested. First real run may reveal message-shape differences — start with `LOG_LEVEL=debug`, `.whoami`, `.ping`, then `.antisticker on` in a test group.

## Known limitations / next ideas
- No per-superadmin overrides or per-group role grants (policy is global tiers).
- Anti-link "all" mode uses a TLD allow-list regex (can miss exotic TLDs).
- `tagall` sends one message (≤1024 mentions).
- Anti-spam counts message rate only (no repeated-text detection).
- No broadcast command (deliberately: ban risk).
- Channel: no AI summaries (feed descriptions only), no images, no per-category schedule, Coursera has no feed, Udemy coupons only via unverified aggregator feed.
- Data is JSON (fine to a few thousand groups); swap `storage/db.ts` for SQLite if needed.
- Ideas: anti-delete, anti-forward, night mode (auto mute/unmute by schedule), captcha for new members, per-group language.

## Working agreements (keep these)
1. Chat text only via `ctx.reply/send` or `sendSafe` (always passes an options object).
2. Admin actions only via `env.sock` / `env.participantsUpdate`.
3. New setting → `GroupSettings` + `defaultGroupSettings()`; call `saveGroups()` after changes.
4. New command → module file + `src/modules/index.ts` + `npm run docs`.
5. Run `npm run check && npm test` before finishing any change.

## Where to look
| Symptom | Read | File |
|---|---|---|
| Owner shows as `user` | `02-PERMISSIONS.md#identity` | `core/identity.ts`, `permissions/roles.ts` |
| Filter doesn't delete | `05-MODERATION.md#filters` | `modules/protection/filters.ts`, bot must be admin |
| Command ignored | `01-CORE.md#dispatcher` (gate order) | `core/dispatcher.ts` |
| Messages "blocked" | `07-ANTIBAN-INTEGRATION.md` | `core/antibanSetup.ts`, `.health` |
| Add a feature | `04-MODULES.md` | `src/modules/index.ts` |

## Prompt template for resuming with an AI
> Project: wa-modbot (Baileys + baileys-antiban moderation bot). Read `docs/HANDOFF.md`, `docs/00-ARCHITECTURE.md` and the doc for the area I name. Follow the working agreements. Task: <describe>. Finish by running `npm run check && npm test && npm run docs`.

## Change log
- v1.0.0 — initial full build.
- v1.1.0 — channel auto-poster (`modules/channel`), `BotModule.init` hook, 14 new tests.
