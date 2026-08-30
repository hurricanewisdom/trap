# Trap

Prefix-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno)
(TypeScript strict, Node 22), run bare with pm2. 261 commands across five cogs,
covering every live method of the Last.fm API.

**[ARCHITECTURE.md](ARCHITECTURE.md)** describes the layout, the cog system and
the conventions — read that first if you are adding a feature.

## Commands

Prefix commands, `,` by default and configurable per server. **`/help` is the
one slash command** — everything else is typed, which keeps `,toptracks` short
rather than turning it into a three-word path with named fields.

```
,fm                      ,whoknows radiohead
,toptracks @dylan 30d    ,crowns
,lf link                 ,taginfo shoegaze
,collage 4x4 tracks      ,tagartist Radiohead | shoegaze
```

- `,help` / `/help` — the command browser and search
- `,ping`, `,botinfo` — latency, and the host/process/codebase panel
- `,prefix` — what this server answers to
- `,boosterrole` — personal colour roles for boosters
- `,welcome`, `,goodbye`, `,boosts` — messages posted when someone joins, leaves or boosts
- `,alias` — server shortcuts for existing commands
- `,stickymessage` — keep a message at the bottom of a channel
- `,imgonly` — make a channel take images only
- `,autoresponder` — automatic replies when a message matches a trigger
- `,pagination` — several pages behind one message, turned with arrows
- `,disablecommand` — turn commands, modules and events off per channel
- `,filter` — ten chat filters, five of them enforced by Discord's AutoMod
- `,snipe` — what was deleted, edited or unreacted in this channel
- `,lf link` DMs an authorisation link; after that `,fm` works

Everything else is one of the 116 Last.fm commands. `,help` lists them all.

Most Last.fm commands are **subcommands of `,lastfm`** (`,lf`): `,lf toptracks`,
`,lf wk radiohead`. Typing one at top level answers with where it lives.
`,fm` and `,lastfm` are the two that stand alone.

### Custom commands

A member can claim one word in a server as a shorthand for their own now
playing — typing `,<word>` shows their listening. `,customcommand` manages
them; a private word only answers to its owner.

## Prefixes

A server can hold as many as 25 prefixes at once, each at most 8 characters and
without spaces. The dispatcher matches longest-first, so `,,` wins over `,`.

```
,prefix              what this server answers to, and how to change it
,prefix list         just the prefixes
,prefix add ! ?      add one or more, keeping what is set
,prefix remove !     take one away
,prefix set !        replace every prefix with this one
,prefix reset        back to the default
```

Reading is open to everyone; changing needs **Manage Server**. Anyone without
it gets a card saying which permission is missing rather than silence.

Two rules stop a server breaking itself. `add` keeps the default when nothing
custom was set yet, so adding `!` does not silently kill `,` — only `set` does
that, which is the point of `set`. And **mentioning the bot always works as a
prefix**, so a server that sets something unusable can always reach
`@trap prefix reset`.

Prefixes live in Postgres and are cached in process, because the dispatcher
consults them on every message in every channel. If the database is briefly
unreachable the last known value is used, so the bot does not go silent.

## Booster roles

Each booster gets one role of their own, coloured and named by them.

```
,boosterrole #1db954 night owl   make or update yours
,br blue purple                  a two-colour gradient
,br random                       a random colour
,br dominant                     the main colour out of your avatar
,br rename <name>                rename it
,br icon <url>                   set its icon, or clear it with no url
,br share @someone               let someone else wear it
,br remove                       delete it
```

Admin side, all Manage Server: `base` (what new roles sit under), `limit`
(how many the server can hold), `award` (a role handed to anyone who boosts),
`filter` (blocked words in names), `list`, `link` (adopt an existing role) and
`cleanup` (delete roles whose owner stopped boosting). `share max` and
`share limit` cap how many members a role holds and how many roles a member
wears.

Three things bound what the bot can do here, and each says so rather than
failing quietly:

- **Manage Roles**, and the bot's own role has to sit *above* the role it is
  editing. Discord's hierarchy is not a permission you can grant around.
- **Gradients and icons need boost level 2.** The API carries
  `colors: { primary_color, secondary_color, tertiary_color }` regardless, so
  the request is well-formed at any tier; Discord rejects it below the
  threshold and the card repeats what it said.
- **The award role is handed out on the boost itself**, from the same
  `guildMemberUpdate` the greetings use. It is also granted the first time a
  booster runs any booster command, so a boost that happened while the bot was
  down is not missed.

## Greetings

`,welcome`, `,goodbye` and `,boosts` are the same feature three times: one
message per channel, as many channels as you like, `add` / `view` / `remove` /
`list` / `variables` each, six commands apiece, all behind Manage Server. They
share one store and one command factory in `cogs/config/greetings/`, but each
is its own group in `,help` with its own registrar and its own gateway hook —
a shared implementation is not a reason to present them as one thing.

Variables in braces are filled in (`{user}`, `{guild}`, `{guild.members}`,
`{guild.boosts}`, `{guild.level}`, `{user.avatar}` and so on); anything in
braces that is not a variable is left exactly as written, and `add` says which
tokens it did not recognise rather than silently dropping them.

**What actually triggers them is the awkward part**, and it differs per event:

| | how the bot finds out |
| --- | --- |
| boost | `guildMemberUpdate`, `premium_since` going from null to set |
| join | `guildMemberAdd`, or the type 7 system message |
| leave | `guildMemberRemove` |

All three now run off gateway member events, which needs the privileged
**GuildMembers** intent. That cannot simply be requested: asking for an intent
that is not enabled in the Developer Portal closes the gateway with 4014 and the
bot never starts. So the handlers are always wired but the intent is only added
when `GUILD_MEMBERS_INTENT=1` is set, which it now is.

Boost detection needs a little care, because an update event carries no "before"
state. `booster_state` remembers each member's last known `premium_since`, and a
boost is announced only on a **null to set** transition that was actually
observed: a member seen for the first time is recorded silently, so a redeploy
does not announce every existing booster. A Redis key holds the announcement for
five minutes, so the system message and the member update cannot both fire for
the same boost.

## Aliases

`,alias add <shortcut> <command>` makes one word run another command, per
server, up to 100 of them. `remove`, `removeall`, `view`, `list` and `reset`
do the rest, all behind Manage Server.

Whatever is typed after the shortcut is passed straight through, so a shortcut
for `lastfm toptracks` still takes a member and a period. A shortcut may also
carry preset arguments, and `removeall <command>` clears those too rather than
only the bare form.

**A shortcut can never shadow a real command.** They resolve through
`onUnmatchedCommand`, which only runs once nothing in the registry matched, and
`add` refuses a word that is already a command or subcommand. That ordering is
the safety property: adding an alias can never take a working command away from
the server.

## Sticky messages

`,stickymessage add <channel> <message>` keeps one message as the last thing in
a channel. `view`, `remove` and `list` do the rest, all behind Manage Server.

It **waits for the chat to settle** rather than reposting on every message: each
message resets a short timer and only the last one fires, so a burst of six
produces one repost instead of six. The previous copy is deleted before the new
one goes up, so the channel never accumulates duplicates, which means the bot
needs Manage Messages there.

The `onMessage` hook it rides on runs for every guild message, so the check in
front of it is a cached set of channel ids rather than a query. Bot messages are
ignored before the hook is reached, which is also what stops the sticky
retriggering on itself.

## Autoresponders

```
,autoresponder add hello, hey {user}!        create one
,autoresponder update hello, hi {user}!      change the reply
,autoresponder remove hello                  delete one
,autoresponder list                          every trigger
,autoresponder list tickets                   just the ones marked --ticket
,autoresponder variables                      what a reply can use
,autoresponder role add @Verified verify      give a role when it fires
,autoresponder role remove @Muted unmute      take one away
,autoresponder role add list verify           what it gives
,autoresponder exclusive #general hello       limit it to a channel or role
,autoresponder exclusive list hello           who has access
,autoresponder reset                          clear the lot
```

Fifteen commands, all **Manage Channels**, up to 100 triggers per server. The
trigger and the reply are separated by a **comma**, which is what lets a trigger
contain spaces. Replies take the same variables as the greetings, and `add`
reports any brace token it did not recognise rather than dropping it.

Flags: `--strict` matches the whole message instead of a word inside it,
`--delete` removes the message that triggered it, `--reply` answers as a reply,
`--ticket` marks it for `list tickets`.

**Matching is on word boundaries**, so `cat` answers "look a cat!" and stays
quiet on "concatenate". That is the difference between a useful autoresponder
and one that fires on half the sentences in the server.

Three things stop it becoming a nuisance or a weapon:

- **A four second cooldown per trigger per channel**, so one word in a busy
  channel produces one reply rather than a stream of them.
- **`@everyone` and `@here` can never be pinged**, whatever the reply says:
  the send is pinned to `parse: ["users", "roles"]`. Manage Channels is a lower
  bar than Manage Server, so the reply is not treated as fully trusted.
- **Role grants are checked against Discord's hierarchy** when they are set up,
  not silently at fire time: the bot needs Manage Roles and its own role above
  the one it hands out, and `@everyone` is refused outright.

`exclusive` inverts the default: with nothing listed a trigger answers everyone
everywhere, and the moment a role or channel is listed it answers only there.

Like every other message-path feature, the matcher reads an in-process cache
invalidated on write, never the database. A server with no autoresponders costs
one map lookup per message.

## Availability

Three things can be switched off, each with its own pair of commands.

```
,disablecommand #general fm        one command, in one channel
,disablecommand @someone fm        one command, for one member
,disablecommand all fm             one command, everywhere
,disablecommand list               what is off
,disablemodule #general lastfm     a whole cog, so every command in it
,disableevent #general filter      something the bot does that is not a command
,copydisabled #old #new            carry a channel's whole set to another
```

Every `disable` has a matching `enable`, and `disablemodule` and `disableevent`
carry their own `list`. Sixteen commands, all **Manage Channels**.

**A module is a cog** — `information`, `configuration`, `utility`, `lastfm`,
`help` — so switching one off takes every command in it with it.

**An event is something the bot does that nobody typed**: `autoresponder`,
`filter`, `gallery`, `snipe`, `sticky`, `reactions`, and the three greetings.
These are enforced in `core/hooks.ts` rather than in each feature: a handler now
registers with a name (`onMessage(police, "filter")`), and the emitter skips a
named handler whose event is off in that channel. One check covers every
feature, including ones added later, instead of nine features each remembering
to ask.

⚠️ **The commands that switch things back on can never be switched off.** A
server that disabled `,enablemodule` in every channel would have no way back
short of a database edit. `PROTECTED` in `core/availability.ts` holds them, and
the gate ignores a rule naming one even if a row somehow exists — so a stale row
cannot lock anyone out either.

Only whole commands can be disabled, not their subcommands: `,filter caps` says
so and points at `,filter`. The gate runs at dispatch, where only top-level
commands arrive, so a promise to disable a subcommand would be one the
enforcement could not keep.

`,disablecommand` is the only one that takes a member as well as a channel,
because a module or an event has no per-member meaning. Everything reads an
in-process cache invalidated on write, and a guild with nothing disabled costs
one empty-array check per message.

## Pagination

```
,pagination set <link>                        make one of my embeds page 1
,pagination add <link> {title: Two}           add a page
,pagination update <link> 2 {title: Rewrite}  rewrite one
,pagination remove <link> 2                   delete one
,pagination list                              every pagination here
,pagination restorebuttons <link>             put the buttons back
,pagination delete <link>                     stop paginating that message
,pagination reset                             clear them all
```

**Manage Messages**, except `reset`, which asks for **Administrator** because it
takes out every pagination in the server at once. Up to 25 pages a message and
50 paginations a server.

⚠️ **Discord only lets a bot edit its own messages**, so a pagination can only
be built on an embed Trap posted. `set` checks the author against the bot's own
id and says so plainly rather than failing later with a 403 nobody can read.

Pages after the first are written in page code, the same brace style the rest of
the bot uses: `{title:}`, `{description:}`, `{color:}`, `{footer:}`, `{author:}`,
`{image:}`, `{thumbnail:}`, `{url:}`. Anything unrecognised is named back rather
than dropped.

Readers turn pages with **Back** and **Next** buttons underneath, and the middle
button shows the position. Anyone can press them; only setting the pages up
needs a permission.

Buttons rather than reactions for three reasons. The bot needs no Add Reactions
permission. Nothing has to be cleaned up after a press, where a reaction has to
be taken back off before the same arrow can be used twice. And the page number
lives on a disabled button instead of being appended to the footer, so a page's
own `{footer:}` is left exactly as it was written — a stored page is never
rewritten just to be displayed.

The buttons carry a fixed custom id, and which message was clicked comes from the
interaction itself, so a pagination keeps working across restarts with no state
in the id.

**Page ids are stable and never renumber.** Deleting page 2 of three leaves ids
1 and 3, so an id copied out of `pagination list` is still valid afterwards. The
alternative — compacting the numbers — silently retargets every id somebody
already wrote down.

⚠️ **A message link is one token, and stripping only the part a regex matched
leaves the rest of it behind.** `channels/…/…/…` matched inside
`https://discord.com/channels/…`, so removing just the match left
`https://discord.com/` sitting where the page id should be, and `update` and
`remove` read that as the id. The whole whitespace-delimited token is removed
now. `add` never showed it, because it scans for `{…}` blocks and ignores the
leftovers.

## Filters

`,filter` is ten filters behind one command, 34 commands in all.

```
,filter add <word>                filter a word, * wildcards allowed
,filter whitelist <word>          let one through
,filter caps on --threshold 60    percent uppercase, default 70
,filter emoji on --threshold 3    emoji per message, default 10
,filter spoilers on               spoilers per message, default 5
,filter massmention on -t 5       mentions per message
,filter invites on                server invites
,filter links on                  any link
,filter links whitelist github.com
,filter musicfiles on             audio attachments
,filter spam on --threshold 5     messages per five seconds
,filter regex <pattern>           filter by pattern
```

`,filter` on its own reports what is set and how much AutoMod budget is left.
Every filter takes `exempt <role>` and `<#channel> off`, and each reads back its
own state when run bare. Arguments are **flags** (`helpers/flags.ts`), so
`--threshold`, `--limit` and `-t` are the same thing and order does not matter.

**Five of the ten are enforced by Discord, not by the bot.** Words, invites,
links, patterns and mass mentions are written into the server's own **AutoMod**
rules, so a blocked message is refused as it is typed and never posts at all.
Nothing is deleted after the fact, no Manage Messages is needed, and the filter
keeps working while the bot is down.

The other five — caps, emoji, spoilers, music files and rate — are deleted by
the bot from `onMessage`, because AutoMod cannot express them.

⚠️ **AutoMod only ever sees message text.** It cannot read attachments at all,
which is why `,filter musicfiles` has to be bot-side: an `.mp3` is matched on
its content type and its extension, after the message exists. Anything that
depends on what was uploaded rather than what was typed lands on the same side
of that line.

What Discord allows, all discovered by asking it rather than from the docs:

| | |
| --- | --- |
| keyword rules per server | **6**, and Trap uses up to 4 of them |
| regex patterns per rule | 10 |
| keywords / allow-list entries | 1000 / 100 |
| exempt roles / channels | 20 / 50 |
| mass-mention rules | **one per server, and undeletable in a Community server** |

Two of those shape the commands. The 6-rule cap is a server-wide budget shared
with every other bot, so `,filter` prints what is left rather than letting rule
7 fail with a bare 400. And because `MENTION_SPAM` is a singleton,
`,filter massmention` **edits whatever mention rule already exists** rather than
making its own, and the card names the rule it is touching when that rule is not
one of Trap's.

AutoMod's regex is the Rust engine, which has **no backreferences and no
lookaround**. `,filter regex (a)\1` is rejected by Discord, and the card says
which feature is missing instead of showing a raw 400.

Everything here needs **Manage Channels**, except `reset`, `regex` and
`wordmigrate`, which need Manage Server — they clear or rewrite rules the whole
server sees. `wordmigrate` copies words out of keyword rules made by hand or by
another bot, and leaves those rules alone so nothing is enforced twice by
accident.

## Snipe

```
,snipe [index]                  the last message deleted here
,snipe edit [index]             the last message edited, before and after
,snipe reaction                 the last reaction removed
,snipe clear                    clear everything stored for this server
,snipe reactionhistory <link>   every reaction logged for one message
```

Reading is open to everyone; `clear` and `reactionhistory` need **Manage
Messages**. An index picks an older one, so `,snipe 3` is the third most recent.

⚠️ **Discord's delete event carries an id and nothing else** — no author, no
content, not even for a message sent seconds earlier. So a snipe is only
possible against a cache the bot keeps itself: `onMessage` records each message
into a bounded per-channel ring, and the delete event looks the id up there.
Edits are the same, because `messageUpdate` delivers the new message and never
the old one. That cache is in process and dies with the process, which is the
honest shape of the feature: a snipe reaches back minutes, not days, and a
deploy wipes it.

Nothing here touches the database. `messageCreate` runs for every message in
every channel, so the write is an in-memory ring bounded three ways: 60 messages
per channel, 600 channels, and 15 snipeable entries per kind per channel, all
evicted oldest-first.

⚠️ **Anything the bot deletes itself is never snipeable.** Otherwise the word
filter is defeated by typing `,snipe`: Trap deletes the offending message and
then offers to print it back. `deleteMessage()` in `core/discord.ts` drops the
id before it issues the delete, so every bot-side deletion — filters, gallery
channels, sticky reposts, and anything added later — is covered by construction
rather than by each caller remembering.

That interlock has to survive **handler order**, which is where the first
version failed. The config cog loads before the utility cog, so the filter
deleted and forgot the message *before* it had been remembered, and the record
then landed anyway. A forgotten id is now held in a suppression set that
`remember()` checks, so the order of the two handlers stops mattering.

`,filter snipe` switches the whole thing off for a server, and clears whatever
is already stored when you do. `,filter snipe #channel off` keeps one channel
snipeable.

## Configuration

Everything is read from `.env`, which pm2 loads with `node --env-file=.env`.
That means the values live in `process.env` inside Node and **never appear in
the process environment**, so checking `/proc/<pid>/environ` to confirm one is
set gives a false negative.

| | |
| --- | --- |
| `DISCORD_TOKEN` | required; a malformed one exits 78 and pm2 gives up |
| `DATABASE_URL`, `REDIS_*`, `PG_POOL_MAX` | Postgres and Redis |
| `PREFIX` | the default prefix, `,`; a server can set its own |
| `GUILD_IDS` | guilds to register `/help` in |
| `COMMAND_SCOPE` | `guild` registers `/help` only in those guilds, which is instant |
| `LASTFM_API_KEY`, `LASTFM_API_SECRET` | without these, linking says so |
| `LASTFM_CALLBACK_BASE` | where Last.fm sends the user back, `https://trap.rocks` |
| `HTTP_BIND`, `HTTP_PORT` | the callback listener |
| `GUILD_MEMBERS_INTENT` | `1` to request the members intent |
| `TRAP_TRACE` | `1` logs raw gateway dispatch names |

`.env.example` carries all seventeen with their defaults.

Three privileged intents are enabled for this application: **Message Content**
(every prefix command depends on it), **Server Members** (joins, leaves and
boosts), and Presence, which the bot does not ask for.

⚠️ Only request an intent that is actually enabled in the Developer Portal.
Asking for one that is not closes the gateway with **4014** and the bot never
starts, which is why `GUILD_MEMBERS_INTENT` is a switch rather than a constant.
Note that the application flags report an enabled intent on an unverified bot as
`*_LIMITED`; that means enabled, not disabled.

## Gallery channels

`,imgonly add <channel>` makes a channel images only; `remove` and `list` do the
rest, all behind Manage Server.

A post has to carry an image, and a caption alongside it is fine — that is the
point of the feature. An image means an attachment Discord typed as one, a file
with an image extension, or a direct link to one. Everything else is deleted, so
the bot needs Manage Messages there.

**Members with Manage Server are exempt**, because otherwise setting the channel
up from inside it would delete the command that did it.

## Run

1. Put the bot token in `.env` (`DISCORD_TOKEN=...`).
2. `npm install && npm run build`
3. `pm2 start ecosystem.config.cjs && pm2 save`

## Deploy

```
python deploy/deploy.py              upload what changed, build, restart
python deploy/deploy.py --dry-run    say what would go, change nothing
python deploy/deploy.py --status     what pm2 thinks is running
python deploy/deploy.py --logs 40    tail the bot log
```

Credentials come from `TRAP_PASSWORD`, or `TRAP_KEY` for a private key, or a
prompt. Run it from PowerShell rather than Git Bash, which rewrites a
`TRAP_REMOTE` beginning with a slash into a Windows path.

Four things it does on purpose:

- **It never uploads `.env`.** The payload is an allowlist, and the archive is
  checked for one before it is sent. The server's copy is the only copy.
- **It deletes `src/` on the server before extracting.** Unpacking over the top
  leaves a locally-deleted file still sitting there, still compiled into `dist`,
  still registering its commands.
- **It installs from the lockfile.** `npm install` re-resolves every dependency,
  and an unpinned `@types/node` moving to 22.20.1 mid-deploy broke a `Buffer`
  that had compiled for weeks. `package-lock.json` is part of the payload and
  `npm ci` is what runs.
- **It waits for a *new* ready line before calling it done.** Matching on the
  log tail alone finds the previous boot's line and reports a crashed restart as
  a success, so it counts them and requires the count to rise.

## Operate

- `pm2 logs trap` — live logs
- `pm2 status` / `pm2 monit` — process list / CPU+RAM dashboard
- `pm2 restart trap` — restart (after `npm run build` for code changes)

A missing/malformed token exits with code 78 and pm2 stops the app instead of
restart-looping (`stop_exit_codes`).

## Components V2

discordeno v21 predates Components V2, so `helpers/components.ts` defines the
types and builders itself. This is safe because the REST layer posts the
interaction body verbatim — no camelCase conversion — so Discord-shaped
(snake_case) component JSON goes over the wire untouched.

A V2 message must set flag `1 << 15` and may not also send `content` or
`embeds`. The limits that actually bite: **4000 characters of text** across the
whole message, **25 options** per select, **every custom id unique**, and
**every option value within a select unique**. Five action rows inside one
container is fine.

The last two have no local symptom. Either duplicate is a 400 from Discord, the
edit never lands, and the user sees "Trap didn't respond in time" — so component
payloads are checked by posting one to a channel and reading the status, not
only by inspecting the structure. Both have shipped: first as selects sharing a
custom id, then as the repeated `exempt` and `list` subcommands under `,filter`
colliding on option value, which killed 18 of the browser's 302 views at once.

## Help

`,help` opens the browser; `/help` is the same thing from Discord's picker,
with **autocomplete** — 25 ranked matches appear as you type, out of every
command. That is what makes the browser usable at this size, and what will keep
it usable at ten times it.

Anything else searches. `,help top` ranks 21 matches; `,help colour` finds
`,lfcolor` from its description; `,help tpt` finds `toptracks` by subsequence.
A command, cog or category name goes straight there instead.

The card is one Components V2 container:

- **Home** lists the cogs as an aligned block of names and counts.
- **A cog** lists only what you can type. A command that owns subcommands is
  marked `,prefix`\*, and opening it shows those subcommands. A large cog opens
  as its categories instead, with **All** for the flat list and an **A-Z** index.
- **A command** shows usage, aliases, details and examples, with **Run**.
- Controls: a cog jump, **Open a command**, **Run a command**, first/back/page
  /next/last, **Search** and **Close**.

Usage and examples are rewritten on the way out, so a catalog line written as
`,tt` before the command moved under `,lastfm` renders as `,lf tt` rather than
telling you to type something that no longer resolves.

The view is **stateless**: which page of which thing, and who owns it, is
encoded in the component custom ids, so it survives a restart and stores
nothing. Only the person who ran it can drive the controls, and the controls
disable themselves after 60 seconds of no clicks.

`cogs/help/catalog.ts` is data only. The browser is generated from the *live
registry* — cog, group and category attribution included — and merely decorated
with the catalog, so a command that is registered but undocumented still
appears rather than silently vanishing. A catalog entry is matched to one
command, not to every command sharing its name: `,filter` and
`,boosterrole filter` are different commands, and before that rule the second
wore the first's documentation and filed itself under the wrong group.

**Nothing in help identifies a command by its bare name.** Names are unique only
within a group, and with 201 subcommands `exempt`, `list`, `add` and `remove`
each belong to a dozen owners. Every id, option value and lookup carries the
full path (`filter caps exempt list`), resolved by `lookupPath()`. `,help` takes
a path too, so `,help filter links whitelist` opens that exact command.

The check that keeps this honest renders **all 302 views** and asserts unique
option values, unique ids, 25 options, 4000 characters and 5 rows per view, then
posts the ones that changed to a real channel. Space those posts out: Discord
answers a burst with 429s that read exactly like component failures.

## Last.fm

`,lf link` mints a random single-use state, stores it in Redis for ten minutes,
and DMs the user a Last.fm authorisation URL whose callback carries that state.
Last.fm redirects to `https://trap.rocks/lastfm/callback/<state>?token=…`, which
nginx proxies to the bot. The bot claims the state with `GETDEL` (so a replayed
or refreshed callback finds nothing), exchanges the token for a session via
`auth.getSession`, and upserts the row.

The link is DMed rather than posted in a channel because anyone who opens it
would bind *their* Last.fm account to the requester's Discord id.

Required config: `LASTFM_API_KEY`, `LASTFM_API_SECRET` (from
<https://www.last.fm/api/account/create>, callback `https://trap.rocks/lastfm/callback`).
Without them the commands explain that linking is unavailable instead of failing.

### Storage

Postgres holds the record (`lastfm_users`); Redis is the read path. Lookups
cache both hits *and* misses — an unlinked user running a command is the common
case, and caching that keeps it off the database entirely. Writes update
Postgres then refresh the cache, so a link or unlink is visible immediately
rather than after a TTL. Every Redis key carries a TTL, because the server runs
`maxmemory-policy noeviction`.

### Now playing

`,fm` reads `user.getRecentTracks` (extended, for the loved flag) and adds the
personal play count from `track.getInfo` as a best-effort second call — a
failure there drops the count rather than the reply. Responses are cached for
eight seconds per Last.fm username: long enough to absorb repeat calls and
several people asking about the same user, short enough that a track change
still shows promptly. The reply is an **embed**, not Components V2 — inline
fields are what produce the two-column Track / Artist layout, and a V2 message
cannot carry an embed. It reacts with a thumbs up and down afterwards, ignoring
a missing Add Reactions permission.

Track and artist names are attacker-controlled text placed inside
`[label](url)`. Only `]` can break out of a label and forge a link, so that is
all that is neutralised — and by swapping in a fullwidth lookalike rather than
escaping, because **Discord does not process backslash escapes inside a link
label**: they render literally, as `Psycho \(feat. Ty Dolla $ign\)`. Last.fm
URLs legitimately contain parentheses, which are percent-encoded on the URL side
so they cannot close the link early.

### Paginated cards

Chart output is a Components V2 **container** with the prev / close / next /
jump buttons *inside* it, so they read as part of the card. A single-page
result shows only the close button rather than three permanently disabled
controls. The jump button opens a modal to type a page number.

Page state lives in Redis keyed by message id with a 15 minute idle TTL, so
pagination survives a restart and cleans itself up. Only the person who ran the
command can drive the buttons. Charts fetch at most 250 rows: the pages are
cached whole, Redis runs `maxmemory-policy noeviction`, and it is shared with
another app on this host — the footer still reports the true total.

### Server-scoped commands

These loop over guild members and hit the Last.fm API once per member, so every
fan-out is bounded: at most 100 members scanned with 5 requests in flight, and
the footer says when a scan was capped. Guild member lists come from the REST
API (`src/core/discord.ts`) and are cached for ten minutes; `hide` computes
Manage Guild from role bitfields, because a gateway message carries no resolved
permissions.

Voting works off the reactions `,fm` already adds. The bot's own seed reactions
are ignored — Discord dispatches those back as ordinary reaction events — and
nobody can vote on their own post. Votes cascade away with the post.

### Customization

Now-playing has four styles. Three are embeds because inline fields are the
only way to get columns; `container` matches the Components V2 card the rest of
the bot uses.

Cards carry **no colour by default**. `,lfcolor` sets one, and it then follows
that person across every Last.fm card they pull up, not just now-playing. It
travels as an ambient value rather than an argument through a hundred call
sites; `,ping`, `,botinfo` and `,help` are outside the Last.fm cog and stay
colourless.

Everything read on the `,fm` path — style, colour, reactions, artwork override
— is cached in Redis for a minute and invalidated on write.

A custom command is a member's own word for "show my now playing", scoped to
one guild. It is resolved only after no real command matches, so it can never
shadow a built-in, and the resolver caches the guild's whole word map for a
minute — an unmatched message must not cost a query. A private alias works only
for its owner; `public` opens it to the server.

Submitted artwork is validated on the way in *and* again on the way out, since
the stored URL ends up rendered in other people's cards: http(s) only, image
extensions or known image hosts, length-capped.

### Networking

The callback listener binds loopback plus the docker bridge (`172.17.0.1`) so
the nginx container can reach it — never `0.0.0.0`, because this host accepts
all inbound TCP and a wildcard bind would publish it to the internet.

## Coverage

The Last.fm cog implements **every non-deprecated method of the Last.fm 2.0
API** — 55 of 55. The ones that no longer exist server-side are not stubbed:
`user.getNeighbours`, `user.getArtistTracks`, `user.shout` and the whole of
`radio.*`, `event.*`, `group.*`, `venue.*` and `playlist.*` were withdrawn by
Last.fm. `auth.getToken` and `auth.getMobileSession` are deliberately absent:
the web callback flow does not need the first, and the second requires holding
the user's password, which this bot will not do.

Two methods still answer, but not usefully, and the commands say so rather
than looking broken:

- `tag.getSimilar` returns an empty list and `@attr.tag: n/a` for every tag,
  including ones as common as "rock". `taginfo` shows similar tags only when
  there are any.
- `tag.getWeeklyChartList` returns week ranges, but Last.fm removed the
  per-tag weekly chart methods that once consumed them, so it is shown as
  "charted weekly since <date>" rather than being browsable.

### Response keys are not predictable from the method name

Worth knowing before adding a chart command. Last.fm wraps the list under a
different key per method, and it does not follow from the method:

| Method | Key |
| --- | --- |
| `tag.getTopArtists`, `geo.getTopArtists` | `topartists` |
| `chart.getTopArtists` | `artists` |
| `tag.getTopAlbums` | `albums` |
| `artist.getTopAlbums` | `topalbums` |
| `tag.getTopTracks`, `chart.getTopTracks`, `geo.getTopTracks` | `tracks` |
| `artist.getTopTracks` | `toptracks` |

Deriving it as `top${kind}` looks right and silently returns nothing for half
of them, which is how `genretracks`, `hot` and `trending` shipped broken.
`chartItems()` in `api/discovery.ts` locates the container instead of guessing
its name.

### Artwork

Last.fm returns real covers for albums but **the same placeholder star for
every artist and every top track** — present in the response, and meaning "no
art". `integrations/artwork.ts` knows that and fills the gap from the **iTunes
Search API**, which needs no key.

iTunes has no artist photographs, so an artist is represented by the cover of a
record credited to them. That matters: searching iTunes for "Snoop Dogg"
returns an album by somebody else that merely features him, so the artist name
is passed as the expected credit and rows by anyone else are skipped.

### Crowns

A crown is per-server and per-artist, and goes to the member with the most
plays. Being the only listener wins it: a server can have a dozen linked
members and one person who has actually played the artist.

`globalwhoknows` run inside a server settles that server's crown too, but not
from its top row — a global listing ranks every linked account, so the winner
may be in another server. It is filtered to members of the server the command
was run in, minus anyone hidden there, and the best of those wins. In a DM
nothing is awarded.

A truncated scan never writes the table. Its "top listener" is the top of a
sample, and storing that would leave the wrong holder in place for every later
`crowns` and `mostcrowns` read.

## Statistics

`,botinfo` is a monospace panel: CPU, host memory and disk as proportional
bars, then process figures, then the codebase.

CPU comes from two samples of `os.cpus()` about 120ms apart rather than
`os.loadavg()`, which means something different — a queue length averaged over
a minute, reading zero on a briefly pinned box and staying high after work
stops. Disk uses `bavail` rather than `bfree`, since the root-reserved blocks
are not usable space. Source file and line counts walk `src` once and are
cached; they cannot change without a redeploy.
