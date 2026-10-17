# 08 · WhatsApp Channel auto-poster

Posts curated **tech, science, security news, blog write-ups and free tech courses** to your WhatsApp Channel at a **fixed, capped interval**, built around one goal: keep the account alive.

Code: `src/modules/channel/` — `text.ts` (formatting/dedupe helpers) · `feeds.ts` (RSS/Atom) · `store.ts` (state + default feeds + safety LIMITS) · `engine.ts` (refresh + tick logic) · `index.ts` (`.channel` command + scheduler start). State: `data/channel.json`.

## Setup (3 steps)
1. The linked WhatsApp account must be the **owner or an admin** of the channel (only they can post).
2. `.channel set <your channel link>` (or `CHANNEL_JID=…@newsletter` in `.env`).
3. `.channel on`. First fetch runs ~45 s after start; check `.channel status`.

## How it works
```
every FETCH_EVERY_MIN (60)           every minute
  refresh(): feeds → filter →          tick(): ONE post max, only if ALL gates pass
  dedupe → queue (cap 60)              enabled · channel set · connected · anti-ban risk ok ·
                                       not quiet hours · interval since LAST post · daily cap ·
                                       course daily cap · fresh+approved item exists
```
- **Fixed interval** = `intervalMin` after the *last* post (default 180 min). Persisted, so restarts don't shift or burst it. After downtime it posts **one** item, never a backlog.
- **Hard floors** (`LIMITS` in `store.ts`, enforced by the commands): interval ≥ 30 min, ≤ 12 posts/day, manual `postnow` ≥ 10 min after the last post, manual `fetch` ≥ 5 min apart.
- **Quiet hours** (default `23-6`, `Africa/Lagos`): nothing posts.
- **Category rotation**: prefers a different category than the previous post.
- **Dedupe**: canonical link (tracking params stripped) + first-10-words title key, against queue and 30-day history. Skipped items are remembered too.
- **Freshness**: news/blogs ≤ 48 h old, courses ≤ 6 h (coupons die fast).
- **Failure handling**: send failure → retry in 10 min, dropped after 3. Anti-ban risk `high`/`critical` → posting pauses by itself. A feed failing 5× in a row is auto-disabled.
- **Optional review mode** (`.channel review on`): nothing posts until you `.channel approve <n|all>`.

## Sources {#sources}
Free RSS/Atom only (no API keys, no scraping HTML). Defaults (seeded once): Ars Technica, Hacker News (150+ points), TechCrunch · BleepingComputer, The Hacker News, Krebs · ScienceDaily, Phys.org, NASA · Cloudflare, GitHub, Google Security blogs, freeCodeCamp, Julia Evans.
Manage: `.channel sources`, `.channel test <n>`, `.channel feed <n> on|off`, `.channel addfeed <tech|science|security|blog|course> <name> <url>`, `.channel delfeed <n>`.

> ⚠️ The sandbox this was built in could not reach the internet, so **no feed URL was tested live**. Run `.channel test <n>` for each source on first use; dead ones auto-disable.

### Free courses (honest status)
- **Udemy:** there is no official free API for 100%-off coupons. The only free route is coupon-aggregator RSS feeds. One (`coursejoiner.com/feed/`) is seeded **disabled** because the URL is unverified and aggregator terms/quality vary — test it, read its terms, then enable. Course items are posted only if the title matches a tech/science keyword list (`isTechCourse` in `engine.ts`) and only within 6 h of publication; check the coupon still works before relying on it.
- **Coursera:** I found no free public feed of free courses. If you have a feed URL, add it with `addfeed course …`.
- freeCodeCamp's feed is enabled as a **blog** source (always-free learning articles).

## Formatting {#formatting}
```
🔐 *Title*            ← bold title, markup characters stripped
Short summary (≤260 chars, HTML stripped)
🔗 original link
— Source name         ← attribution; never copies full articles
```
Sent as plain text through the anti-ban socket (options object always passed).

## State {#state}
`data/channel.json`: `settings`, `feeds`, `queue`, `history`, `lastPostAt`, `lastFetchAt`, `lastCategory`. `CHANNEL_*` env vars only seed `settings` on first creation; afterwards `.channel` is the source of truth.

## Commands (owner by default; delegate with `.superfeatures add channel`)
`status` · `set <link|jid>` · `on` · `off` · `interval <min>` · `max <n>` · `quiet <23-6|off>` · `review on|off` · `queue` · `approve <n|all>` · `skip <n>` · `postnow` · `fetch` · `sources` · `test <n>` · `feed <n> on|off` · `addfeed` · `delfeed <n>`

## Candid risk notes
- Channel posting through an unofficial client is **unverified against live WhatsApp** here; Baileys exposes `newsletter*` APIs and sends to `@newsletter` JIDs, and tests cover our side (wrapper accepts the JID, scheduling, caps). First live test: `.channel set`, `.channel postnow`.
- Fixed gaps are safer than bursts, but perfectly regular timing is itself a bot signal. Consider an odd interval (e.g. 170/185) rather than round numbers.
- Low volume (≤ 6/day) and original-link attribution are the safest posture. Raising the caps raises risk.
- The channel owner account is the risk surface: use a number you can afford to lose.
