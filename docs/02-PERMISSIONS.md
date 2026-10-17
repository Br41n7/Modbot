# 02 · Roles, identity and the permission policy

## Roles (`permissions/roles.ts`)
| Role | How someone gets it |
|---|---|
| **owner** | phone ∈ `OWNER_NUMBERS`, or LID ∈ `OWNER_LIDS`, or message is `fromMe` and `SELF_IS_OWNER=true` |
| **superadmin** | phone stored in `db.global.superadmins` (owner runs `.addsuper`) — works in every group and in DMs |
| **admin** | WhatsApp admin of the *current* group |
| **user** | everyone else |

Hierarchy is cumulative: `user < admin < superadmin < owner`.

## Identity: the LID problem {#identity}
WhatsApp shows many people as `123…@lid` instead of `+234…`. The owner is configured by number, so the bot must map LID → number. It tries (in order): persisted map, `participantAlt` on the message key, group participant `phoneNumber`, Baileys' own LID store. Results are saved in `data/global.json → lidMap`.

**If the owner shows as `user`:** send `.whoami`. If it prints `OWNER_LIDS=…`, put that in `.env` and restart.

## Policy (`permissions/policy.ts`) {#policy}
```
effectiveRole(feature) = db.global.policy[feature]  ??  command.defaultRole
can(feature, role)     = rank(role) >= rank(effectiveRole(feature))
```
- Feature key = command name unless the command declares `feature` (shared permissions).
- Unknown feature → `owner` (fail closed).
- `ownerLocked` commands (`addsuper`, `delsuper`, `setrole`, `resetrole`, `superfeatures`, `userfeatures`, `setprefix`, `shutdown`) can never be re-tiered.

### The three things the owner controls
| Goal | Command | Effect |
|---|---|---|
| let superadmins run X | `.superfeatures add X` | X's tier becomes `superadmin` |
| take it away again | `.superfeatures remove X` | X back to `owner` |
| let everyone run X | `.userfeatures add X` | X's tier becomes `user` |
| make X admin-only again | `.userfeatures remove X` | X's tier becomes `admin` |
| any exact tier | `.setrole X <user\|admin\|superadmin\|owner>` | explicit |
| undo | `.resetrole X` | default |
| inspect | `.perms`, `.superfeatures`, `.userfeatures` | lists tiers |

Because tiers stack, a feature in the **admin** tier is automatically available to superadmins; to hide an admin-tier feature from superadmins you would have to make it owner-only (`.superfeatures remove` explains this when it applies).

### Per-group switch (separate from roles)
`.disable <cmd>` / `.enable <cmd>` (group admins) hide a command in one group; owner/superadmins are exempt.

### Safety rules for acting on people (`services/moderation.canAct`)
Never: the bot itself, the bot owner, someone of equal/higher rank, the group creator (unless caller is owner). So admins can kick members but not other admins; superadmins can kick admins.

### Not implemented (ideas)
Per-superadmin overrides (different superadmins, different powers); per-group role grants. See `HANDOFF.md`.
