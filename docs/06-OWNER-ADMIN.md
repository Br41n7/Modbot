# 06 · Owner / superuser guide

Only numbers in `OWNER_NUMBERS` (or `OWNER_LIDS`, or the bot's own account when `SELF_IS_OWNER=true`) get owner rights. Owner commands work in DMs and groups.

## First-time setup
1. `.env`: `OWNER_NUMBERS=<your number, digits, country code first>`.
2. Start the bot, link WhatsApp, send `.whoami` — it must say `Role: owner`. If not, copy the printed `OWNER_LIDS=` line into `.env`.
3. Add the bot to a group, **make it admin**, run `.settings`.

## Command list
| Group | Commands |
|---|---|
| People | `.addsuper`, `.delsuper`, `.supers`, `.ban`, `.unban`, `.banlist` |
| Policy | `.perms`, `.setrole`, `.resetrole`, `.superfeatures [add\|remove X]`, `.userfeatures [add\|remove X]` |
| Bot | `.setprefix`, `.mode public\|private`, `.health`, `.groups`, `.leave [id]`, `.shutdown` |

(`.addsuper/.delsuper/.setrole/.resetrole/.superfeatures/.userfeatures/.setprefix/.shutdown` are owner-locked.)

## Recipes
- **Make Sam a superadmin who can kick and ban:** `.addsuper 2348055555555` → `.superfeatures add ban` (kick is already admin-tier, so superadmins have it).
- **Let every member use `.antisticker`:** `.userfeatures add antisticker`.
- **Lock a command to superadmins:** `.setrole kick superadmin`.
- **Put the bot in maintenance:** `.mode private` (only owner/superadmins can run commands; filters still protect groups).
- **Silence a troll everywhere:** `.ban @user reason`.
- **See what each tier can do:** `.perms`.
