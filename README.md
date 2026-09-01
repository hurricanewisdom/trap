# Trap

Prefix-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno)
(TypeScript strict, Node 22), run bare with pm2. 683 commands across eight cogs,
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
- `,ignore` — members and channels the bot reads nothing from
- `,pin`, `,unpin`, `,firstmessage`, `,pins` — pins, and archiving them
- `,seticon`, `,setbanner`, `,setsplashbackground` — the server's look
- `,webhook` — post as a named identity in a channel
- `,fakepermissions` — let a role use the bot without the real permission
- `,extractemotes`, `,extractstickers` — the server's emojis or stickers as a zip
- ~~`,reposter`~~ — **switched off for now**, see below
- `,badge` — reward members who wear the server tag on their profile
- `,suggest` — members suggest ideas, staff move them through statuses
- `,customize` — the bot's own avatar, banner and bio in one server
- `,filter` — ten chat filters, five of them enforced by Discord's AutoMod
- `,ban`, `,tempban`, `,softban`, `,hardban`, `,warn`, `,timeout` — punishments, each writing a case
- `,history`, `,caselog`, `,reason`, `,proof`, `,notes` — the case log and what is on it
- `,jail`, `,mute`, `,imute`, `,rmute` — holding somebody's roles, and three kinds of mute
- `,role` — twenty ways to give, take, edit and mass-assign roles
- `,purge` — twenty-one ways to clear messages
- `,lockdown`, `,unlock`, `,hide`, `,slowmode`, `,nuke` — channel control
- `,thread`, `,remind`, `,stickyrole`, `,restrictcommand`, `,raid` — the rest of moderation
- `,snipe` — what was deleted, edited or unreacted in this channel
- `,antinuke` — nineteen ways to watch a server being taken apart, owner only
- `,roleplay` — sixty-two reaction commands, off until a server enables them
- `,embed`, `,createembed`, `,editembed`, `,embedcode` — rich messages, written as a code
- `,afk` — tell people you are gone, and see what you missed
- `,names`, `,gnames`, `,topcommands` — name history, and which commands get used
- `,nba`, `,nfl`, `,mlb`, `,nhl`, `,soccer` — today's games
- `,run` — code in a sandbox, `,ask` — a model on the box
- `,transcribe`, `,shazam`, `,makemp3` — what was said, what was playing, and the audio
- `,rps`, `,choose`, `,wouldyourather`, `,poll`, `,quickpoll` — the small ones
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

## Editing a command

Fix a typo in a command and it runs. Edit `,pign` into `,ping` and you get the
answer, without deleting and retyping. Edit a command that already ran into a
different one and both replies stand, in the order you made them.

⚠️ **`messageUpdate` fires for things nobody edited.** A link preview resolving,
a pin, an attachment finishing its upload — all arrive as an update carrying the
same content. Re-running on every update would mean any command with a link in
it silently runs twice. So the bot keeps the last content it saw for recent
messages and only acts when the text actually changed. **If it has no record of
the message it does nothing**, which is the safe way round: a missed rerun is an
inconvenience, a phantom one is a command nobody typed.

Three more bounds. A message older than **15 minutes** is left alone, so editing
something from yesterday does not fire. There is a **1.2 second cooldown** per
message, so holding down edits cannot spam. And a deleted message is forgotten
outright.

The edit goes through exactly the same path as the original — one
`runPrefixCommand`, called from both events — so prefixes, the disabled-command
gate, group routing and card colour all behave identically. A second dispatch
path would drift from the first.

`,disableevent #channel editrerun` switches it off.

## Extract

```
,extractemotes      every emoji in this server, zipped
,extractstickers    every sticker
```

**Administrator**, since it hands somebody the whole set in one file.

Animated emojis come out as `.gif` and the rest as `.png`. Stickers follow
Discord's three formats: PNG and APNG as `.png`, GIF as `.gif`, and a Lottie
sticker as the `.json` it actually is, rather than an image extension that would
not open.

Names come from the emoji, cleaned of anything a filesystem would object to, and
a repeated name gets a number instead of overwriting the first. Six download at
a time, nothing over 8MB each, and the archive stops at 24MB with the card
saying how many were left out — a server can hold far more emoji than Discord
will let the bot upload.

**The zip is written by hand**, in about sixty lines, rather than adding a
dependency for one command. Entries are stored rather than deflated: emoji are
already PNG or GIF, so compressing them again buys a percent and costs the whole
of zlib per file. `zlib.crc32` does the checksums, which Node has had since 20.

## Messages

```
,pin                       pin the last message here
,pin <link>                pin that one
,unpin                     unpin the most recent pin
,firstmessage [#channel]   a jump link to a channel's first message
```

`pin` and `unpin` need **Manage Messages**; `firstmessage` is open to everyone.
These act on a message in front of you, which is why they sit in Utility rather
than with the pin archive: nothing about them is configured per server.

`pin` checks Discord's 50-pin cap before trying, so a full channel gets a
sentence about `,pins archive` rather than an API error.

## Information

**84 commands** answering questions, in four groups: what Discord already
knows, what another service knows, what to do with a picture, and what somebody
has asked to be told about. Anything that returns a list pages rather than
truncating, and the info cards report everything Discord hands over rather than
a name and a date.

```
serverinfo / userinfo / roleinfo / channelinfo / membercount / inviteinfo
avatar / banner / serveravatar / serverbanner / guildicon / guildbanner / splash
roles / emotes / bots / members / boosters            emoji (8) / sticker (5)
rotate / invert / compress / hex                      highlight / birthday / timezone / seen
define / urbandictionary / minecraft / github / steam / telegram / snapchat / roblox (8)
```

⚠️ **Six of these names already belonged to a subcommand** — `avatar` and `banner`
to `customize`, `emoji` to `filter`, `roles` to `autoresponder`, `emotes` and
`bots` to `purge`. Registering them at the top level is right, and safe: `lookup`
checks the top-level registry first and only then falls through to the group
namespaces, so `,avatar` is now the profile command while `,customize avatar`
still works through its parent. An **alias** clash is different — `mc` was already
`membercount`, and the registry refused it for `minecraft` with a warning rather
than silently taking it.

### Every list pages, and nothing is cut off

`roles`, `members`, `bots`, `emotes`, `boosters`, `sticker`, `birthday list` and
`timezone list` all return pages with **Back / Next / Page / Close** underneath,
through the same pager the Last.fm cards use. Before this they each stopped at a
hardcoded cap — 60 roles, 50 bots, 25 boosters — and said "and 14 more", which on
a real server meant the command could not answer the question it was for.

Each row now carries what you would otherwise have run a second command to get:
a role shows its member count, colour and whether it is hoisted or managed; a
member shows when they joined and their nickname; an emote shows its `:name:`,
whether it is animated and when it was added; a booster shows the date and how
long ago. Lists are ordered by what they are read for — roles highest first,
members and bots oldest first, birthdays **soonest** first rather than by
calendar month, timezones by local clock so the people awake sit together.

⚠️ **`timezone list` was showing thirty rows under a heading counting sixty.**
The query took `LIMIT 60`, the render took `.slice(0, 30)`, and the heading
counted the query. Half the list was missing and the number above it said
otherwise.

⚠️ **`@everyone` is in nobody's role list.** A member's `roles` array never
includes it, so `members @everyone` filtered the obvious way answers "0 in
@everyone" on a role that holds the entire server. It is the one role that has to
be special-cased, in `members` and in `roleinfo` both.

⚠️ **Counting roles the obvious way is quadratic.** `roles` needs a member count
per role, and asking "how many members have this role" once per role is a hundred
roles times five thousand members. One pass over the members, incrementing a map,
is the same answer for a five-hundredth of the work.

### What the info cards carry

`serverinfo`, `userinfo`, `roleinfo`, `channelinfo`, `membercount` and
`inviteinfo` were each a name, an id and a date. They now report what Discord
actually hands over:

| | added |
| --- | --- |
| `serverinfo` | channel counts by kind, verification level, content filter, 2FA-for-staff, age rating, AFK channel and timeout, system/rules/mod-update channels, vanity, language, emoji slots used against the tier's limit, boosts needed for the next level, description |
| `userinfo` | badges, top role and its colour, every permission their roles add up to, join position (`4th of 36`), timeout status, whether they wear the server tag, banner and accent, `@username` under the display name |
| `roleinfo` | permissions, share of the server wearing it, position out of the total, gradient colours, role icon, unicode emoji, what manages it, and the first fifteen members |
| `channelinfo` | category, position, bitrate/user limit/region for voice, forum tags, thread archive time, permission-override counts split by roles and members, and when the last message was |
| `membercount` | humans against bots, online now, boosters, joined today/this week/this month, and who is newest |
| `inviteinfo` | server id and age, channel kind, inviter id, share of members online, boosts, verification, age rating, vanity and features |

⚠️ **The last message time is free.** A channel's `last_message_id` is a
snowflake, and a snowflake carries its own timestamp, so "is this channel dead"
costs no extra request and needs no Read Message History.

⚠️ **A server can report boosts while nobody is boosting.** Discord counts
subscriptions against the guild, not boosters in it, so somebody who bought a
boost and then left still holds the tier up — `0ping.net` reports 28 boosts and
level 3 with no current member carrying `premium_since`. Printing "0 boosting"
under a footer reading "28 boosts" reads as a bug, so `boosters` names the gap
instead and says Discord will not reveal who they were.

### The ones that needed a key

`weather`, `valorant` and the Roblox account links read their keys from `.env`
(`OPENWEATHER_API_KEY`, `HENRIK_API_KEY`, `BLOXLINK_API_KEY`), and `steam` uses
`STEAM_API_KEY` for the level, game count and real name on top of the keyless
profile. A missing key is reported as a missing key, not as the service being
down.

⚠️ **`xbox` needs no key.** The obvious provider would not hand one out, and
`playerdb.co` answers for a gamertag without one, so that is what it asks.

⚠️ **A new OpenWeatherMap key is refused for up to a couple of hours**, which
looks exactly like a wrong one. The command says which it is.

⚠️ **Riot only exposes a Valorant account through recent match data**, so a player
who has not played lately cannot be looked up at all. The reply says that rather
than "no such player", because the name is usually fine.

⚠️ **Bloxlink's routes disagree with each other.** `discord-to-roblox` says
`Unknown Guild` where `roblox-to-discord` only says `User not found`, so the
second is checked against a second request before being believed — and that
request has to name a **real** account, because Bloxlink checks the user before
the guild and a made-up id never reaches the guild check. Both directions now say
the same thing about a server that does not use Bloxlink.

`osu` is deliberately absent.

### What answers without a key

Every one of these was tried from the box before it was written, because a
datacenter address is not a normal visitor:

```
dictionary ✓   urban ✓   mojang ✓   roblox ✓   github ✓   t.me ✓   steam ✓   snapchat ✓
```

⚠️ **GitHub allows this address sixty anonymous requests an hour**, shared with
everything else on it. The command says so when it runs out rather than claiming
the user does not exist.

⚠️ **Steam needs no key** because a profile has an XML view. The richer data —
games, level, playtime — does need one.

⚠️ **Nothing here can connect a Roblox account to a Discord one.** That link only
exists inside Bloxlink or RoVer, and both want an API key, so those two commands
say so instead of guessing.

### Pictures go through ffmpeg

`rotate`, `invert` and `compress` are ffmpeg filters, and `hex` is a one-pixel
downscale, which is the average colour and what people mean by the dominant one.
No image library was added.

⚠️ **These fetch whatever address they are given**, so they carry the same guard
`customize` does: the host is resolved first and refused if it is loopback,
private, link-local or carrier NAT, and a redirect is refused rather than
followed somewhere the check already rejected.

### `screenshot` runs a real browser, as somebody else

⚠️ **Switched off.** The command, the browser and the guards are all still here,
just not registered, so it has no name and no help entry. One commented line in
`cogs/general/images.ts` brings it back. The rest of this section still describes
it, and the two things worth knowing before picking it up again are which user
Chrome runs as and why the private-address guard is load-bearing.

`screenshot <url>` hands the page to headless Chrome and posts the 1280×800 PNG.
A hosted screenshot API would have wanted a key and a monthly bill; Chrome on the
box wants 400MB once, and no request leaves for a third party.

⚠️ **It does not run as the bot.** The bot is root, and this command points a
full browser engine at a stranger's URL. Chrome runs as `trapshot`, an
unprivileged system account with `nologin` and nothing to reach, which is also
what lets the **sandbox stay on** — the sandbox needs user namespaces, and root
would have had to give it up with `--no-sandbox` to run at all. Each shot gets a
throwaway directory, chowned to that user and deleted afterwards; `CHROME_PATH`
and `CHROME_USER` override both.

```
useradd --system --create-home --shell /usr/sbin/nologin trapshot
```

⚠️ **The private-address guard matters more here than anywhere else.** A browser
would happily render this box's own dashboard, database admin page or metrics
endpoint and post the picture to a public channel — `screenshot localhost` is the
whole attack. The same resolve-and-refuse check the other image commands use runs
before Chrome is started.

⚠️ **A scheme that is present is kept.** A bare `example.com` is assumed to be
https because that is what people type, but `ftp://host` is turned away as a bad
scheme rather than parsed into a hostname called `ftp` and refused later for the
wrong reason.

### Things that only start counting now

`seen`, `emoji stats` and `boosters lost` all describe history nobody was
recording. Discord keeps none of it either. Each says so rather than showing an
empty list that looks like an answer — `boosters lost` in particular cannot be
answered at all, because Discord never reports somebody stopping.

⚠️ **`highlight` runs on every message**, so the keyword table is held in memory
and refreshed on write. The membership and ignore checks happen only after a word
matches, which is rare.

⚠️ **`emoji stats` was reading a table nothing wrote to.** `emote_uses` was
created, indexed and selected from, and there was no `INSERT` anywhere in the
codebase — so the command answered "nothing counted yet" and always would have.
The recorder is the half that was missing, and the empty reply is exactly what a
missing writer looks like, which is why it went unnoticed.

Counting happens on the message path, so it does no I/O there: uses are buffered
in memory and written in **one batched statement every thirty seconds**, and
reading the command flushes first so it never contradicts an emote somebody just
watched being used. A failed flush drops that half minute rather than re-queueing
it, and the buffer is capped at twenty thousand, because a raid posting emotes
must not be able to grow it without bound.

⚠️ **The id is stored, not the tag.** A tag carries the emote's name, so storing
`<:party:123>` would split one emote's tally the moment somebody renamed it. The
name is looked up fresh when the ranking is drawn, and an emote that has since
been deleted — or came from another server — is labelled rather than dropped.

⚠️ **One use per message, not per appearance.** Somebody pasting the same emote
forty times in one line is enthusiasm, not forty uses, and counting it as forty
would let one person decide what the server's favourite is.

⚠️ **Emote names are two characters minimum**, which the matcher relies on.
Discord will not create a one-character name, so `<:z:123>` is not an emote and
is not counted — a test that assumes otherwise records nothing and looks like a
broken recorder.

The ranking pages like the rest of the lists, and each row carries the use count,
how many distinct people used it, its share of all uses and when it was last
seen. The footer counts how many of the server's own emotes have never been used
at all, which is the number worth having before a cleanup.

## Antinuke

**19 commands** watching for a server being taken apart, and stopping whoever
is doing it. **Server owner only** — every one of them, including reading the
settings. This is the thing that survives a moderator going bad, so it cannot be
configured by the people it exists to stop; `antinuke trust` is how the owner
delegates it deliberately.

```
,antinuke                       what is on, and what it will do
,antinuke ban|kick|channel|role|emoji|webhook <on|off> [--threshold 3] [--per 60]
,antinuke bot|permissions <on|off>          one is already too many
,antinuke punishment <ban|kick|stripstaff|jail>
,antinuke trust <member>        may change these, and is never punished
,antinuke whitelist <user>      never punished, cannot change anything
,antinuke trust|whitelist list|clear
,antinuke webhookspam exempt [#channel|clear]
```

Everything is **off by default**. Aliases: `antiwizz`, `an`, `aw`.

### It listens to one event, not nine

`GUILD_AUDIT_LOG_ENTRY_CREATE`, which Discord sends the moment anything audited
happens and which carries the actor, the target and the exact change together.

⚠️ **The obvious design is worse, and it is the one this started as.** Reacting
to `channelDelete` and then reading the audit log back costs a request per event
and needs a retry when the entry has not landed yet — but the real problem is
emoji and webhook changes, where the gateway does not say *what* changed. With
no target to match on, the actor has to be guessed from whoever appears most
recently in the log, and two people acting within the same few seconds get each
other's punishment. In a feature that bans people, that is not an acceptable
failure mode. The audit event removes the guess entirely.

It needs the **GuildModeration** intent (not privileged) and **View Audit Log**
in the server. Without either, no events arrive at all and the antinuke stays
silent — which is the right direction to fail, but worth knowing it is silent
rather than working.

### Who it will never touch

The bot itself, the server owner, anyone trusted, and anyone whitelisted. The
owner is not a courtesy — Discord will not let anybody ban them, so acting would
only produce noise and a failed request.

⚠️ **Not knowing who did something is a reason to do nothing.** Every path that
cannot name an actor returns without acting. An antinuke that guesses is worse
than one that misses, because the guess lands on a moderator doing their job.

### Thresholds, and the two that have none

Most modules count: three channel deletions in sixty seconds, and so on, per
person per module, held in memory. `bot` and `permissions` do not, because one
bot added or one administrator granted is already the whole attack.

`permissions` also **reverts before it counts** — the grant is undone the moment
it is seen, whether or not the threshold is reached, because a role holding
administrator is dangerous while the count is still one.

⚠️ **What was granted is not what the role now holds.** The check is
`new & ~old`, so a role that already had administrator and still does has
granted nothing, and re-saving a role's settings does not trip anything.

⚠️ **The gateway sends permissions as a json number where REST sends a string.**
Everything watched sits below bit 31 so no precision is lost, but the conversion
goes through a string rather than through `Number` regardless.

⚠️ **Counts live in memory, not in the table.** Clearing the log does not clear
somebody's count, which is deliberate: a count that could be reset by waiting
for a row to disappear would not be much of a tripwire.

### `webhookspam` has nobody to punish

The other eight modules find a member and act on them. This one cannot: a
webhook has no member behind it, its token is a bearer credential, and whoever
created it is usually the victim of the leak rather than the one using it. So the
message is deleted and **the webhook is destroyed**, and no user is touched.

A webhook message trips it when its mentions reach the threshold, with an
**`@everyone` weighing a full threshold on its own** — one is the whole payload.
Mentions are counted by Discord rather than by reading the text, so one inside a
code block does not count and one in an embed does.

**Announcement channels are exempted per channel**, which is what makes this
usable on a server that has a webhook posting `@everyone` on purpose:

```
,antinuke webhookspam exempt              list them
,antinuke webhookspam exempt #announcements   toggle one
,antinuke webhookspam exempt clear        empty the list
```

Nothing a webhook posts in an exempt channel is touched, whatever it mentions.
One command rather than three, because an exemption list is read far more often
than it is edited. Aliases: `allow`, `ignore`, `channel`.

⚠️ **The exemption is per channel, not per webhook.** A leaked webhook token for
an exempt channel can still mass-mention there — Discord gives a webhook message
no identity beyond the webhook itself, so "this webhook is allowed" is not a
thing that can be checked. Exempt the channel your announcements go to and
nothing else.

The message is removed even when the webhook cannot be, since the mentions have
already fired and leaving the post up only keeps the damage on screen.

### When it trips

The punishment runs, the owner gets a DM naming who, what and the outcome, and a
row goes into `antinuke_events`. A punishment that cannot be carried out falls
back rather than giving up — `jail` with no jail role configured strips staff
roles instead, because leaving somebody in place with their permissions is the
one outcome worth avoiding.

## Moderation

A cog of its own, and the largest: **147 commands** across punishments, the
case log, roles, purging, channel control, threads and reminders.

```
ban / softban / tempban / unban / hardban    warn / timeout / untimeout
jail / unjail / jaillist                     mute / imute / rmute + their unmutes
history / caselog / reason / warnings        proof / notes / modstats
role (20 of them) / temprole                 purge (21 of them)
lockdown / unlock / hide / talk / slowmode   thread / nuke / topic / naughty
remind / stickyrole / restrictcommand        raid / recentban / stripstaff
```

### The case log is the spine

Every punishment writes a numbered case, and `history`, `caselog`, `reason`,
`proof` and `notes` all find their subject by that number.

⚠️ **Case numbers come from the database, in the statement that moves the
counter.** Two moderators acting in the same moment would otherwise be handed the
same number, and the number is the only handle anything else has.

### Anything with a duration is a row, not a timer

`tempban`, `jail`, `mute`, `temprole` and `remind` all write a row with a due time
and are picked up by a slow tick. A restart must not quietly forget to unban
somebody. Rows are claimed with `DELETE ... RETURNING`, so two ticks cannot run
the same one twice.

### Who may act on whom is asked first

Not yourself, not the owner, not somebody above the bot, not somebody at or above
you. Discord refuses halfway through otherwise, and the case log would record a
punishment that never landed.

⚠️ **`nuke` asks twice.** It deletes the channel and everything in it. During
testing, `nuke list` fell through to the bare command — because it had no
subcommand dispatcher — and destroyed the channel it was run in. It now dispatches
its subcommands, takes Administrator rather than Manage Channels, and needs a
second `nuke` within thirty seconds before it does anything.

⚠️ **`moveall` cannot see who is in a voice channel.** Discord only reports that
over the gateway, and this bot does not ask for the voice intent, so both it and
`drag` move the members they are given by name.

⚠️ **Purge leaves anything older than two weeks.** Discord refuses to bulk delete
it, and removing them one at a time would take minutes and burn the rate limit.
The reply says how many were skipped rather than quietly returning a short count.

⚠️ **`restrictcommand` fails open.** A database that cannot be reached should not
lock a server out of its own bot, so an unanswerable restriction is no restriction.

⚠️ **`plain()` truncates at 180 characters.** It is built for a name or a title,
and the cut is invisible at the call site: `run` posted program output through it
and every error longer than 180 characters arrived cut mid-word, looking like the
program had printed that much and stopped. It now takes an explicit limit, and
**text inside a fenced code block should not go through it at all** — markdown is
not interpreted in there, so escaping only puts backslashes through somebody's
output. Containing the backticks is the whole job.

## Miscellaneous

**44 commands** that did not belong to any of the other cogs.

```
embeds     embed (5) · createembed · editembed · embedcode
games      rps · choose · wouldyourather · quickpoll · poll
text       uwu · freaky · color · randomhex · charinfo
scores     nba · nfl · mlb · nhl · soccer · futbol
away       afk · afk mentions
history    names · clearnames · gnames · cleargnames · topcommands
elsewhere  discog (2) · wikihow · makemp3 · transcribe · shazam
sandbox    run · ask
tools      invites · timediff · addemote
```

### Embeds are written as a code

`{title: Hello}$v{description: World}$v{color: #1db954}` — blocks separated by
`$v`, a few keys taking several values separated by `&&`. It is the format the
bots people are coming from already use, so a code pasted from one of those
works here. `embed create <name> <code>` saves one, `embed preview` posts it,
`embedcode <link>` reads a code back **out** of a posted message, and
`editembed <link> <code>` rewrites one already sent.

⚠️ **An unreadable key is reported, not dropped.** Somebody who typed
`{colour: red}` is told the key is wrong rather than handed a colourless embed
and left guessing — but only after the rest of their embed has posted, because
the message they asked for matters more than the note about it.

⚠️ **There is no interactive builder.** `embed create` takes a code rather than
walking through a wizard of buttons and modals. Everything the wizard would set
is reachable from the code, and `embedcode` on an embed you like is the fastest
way to get one.

### Scores come from ESPN

Six commands over one public endpoint that needs no key. `futbol` and `soccer`
are the same board.

⚠️ **ESPN 403s a polite user-agent.** Sending `trap-bot/1.x` — or a full browser
one — is refused; sending **no** user-agent header at all is answered. This is
backwards from every other service here, and the header being *present* is the
failure, so the fetch deliberately sets none.

### Names and command counts start now

`names`, `gnames` and `topcommands` are histories nobody was recording, so all
three begin empty and say so. Names are read back on a member update and written
only when they differ, because Discord fires that event for roles, timeouts and
boosts as well — without the comparison the table would fill with the same name
forever. Command counts buffer in memory and go out in one batched statement
every thirty seconds, the same trade the emote counter makes.

⚠️ **A member update says who changed, never what to.** The event carries an id
and nothing else, so the member and the user both have to be read back and
compared against the last row.

⚠️ **`gnames` needed a gateway event that was not wired.** A server rename only
shows up on `guildUpdate`, which nothing had subscribed to.

### afk

`afk <status>` marks you away, and the next person to mention you is told. Coming
back clears it and says how many mentions you missed; `afk mentions` lists them
with jump links.

⚠️ **Returning is checked before the mentions in the same message.** Saying "back,
and hi @someone-else-who-is-afk" has to both clear yours and answer for them, and
doing it the other way round means somebody who is back is still reported away.

The away list is held in memory because this runs on the message path, and a
failed refresh keeps whatever is cached rather than emptying the map — an empty
map would switch the feature off silently instead of degrading it.

### Running code

`run py print(6*7)`, or a fenced block with a language tag. `run languages`
lists what is installed — fifteen of them, from python and javascript to rust,
go and sqlite.

⚠️ **Piston's public API went whitelist-only in February 2026**, so this runs a
**self-hosted Piston** on the box instead, bound to `127.0.0.1:2000` and nothing
else. It executes code a stranger typed; it must not be reachable from outside.

The sandbox was tested rather than assumed. From inside it: `/root/trap/.env` is
`FileNotFoundError`, `/etc/shadow` is `PermissionError`, `/root` does not exist,
the docker socket is absent, `/proc/1/cmdline` is unreachable, outbound network
raises, a fork bomb hits `EAGAIN`, a gigabyte write fails, and `while True: pass`
is `SIGKILL`ed on a wall-clock limit. It runs as uid 60014 in `/box/submission`.

⚠️ **Client limits must not exceed the server's.** Piston **refuses the whole
request** rather than clamping a `run_timeout` above its configured ceiling, and
the refusal arrives as a plain message with no `run` object — which reads exactly
like the runner being down. The container is configured to allow what the command
asks for.

⚠️ **`node` is not a language name.** Piston registers javascript with the
aliases `node-js` and `node-javascript`, and neither plain `node` nor `js` is
among them, so the two things everybody types both miss. A small synonym table
sits in front of the alias lookup.

### Asking a model

`ask <question>`, or `chatgpt` / `ai` / `gpt`, which all reach the same command.

⚠️ **It is not ChatGPT.** It is **qwen2.5:7b** on this box through Ollama: no
key, no per-question bill, and nothing anybody types leaves the machine. The
spec asked for `chatgpt`, so that name still works, but the card says which model
answered and how long it took. Warm, a real question comes back in one to four
seconds at about 16 tokens a second; the first question after a restart adds
several while the model loads into memory.

**Boosters, and the server owner.** The spec gated this behind the other bot's
donor tier, which Trap has no equivalent of, and boosting is the closest honest
match. The owner is allowed too, and that is not a nicety: Discord counts boosts
against the guild rather than the member, so a server can report twenty-eight
boosts with **no** member carrying `premium_since` — as this one does — and a
strict boosters-only gate would leave nobody able to use it at all.

⚠️ **Ollama binds to every interface by default, and a stale drop-in put it
back.** Installing it left `0.0.0.0:11434` listening with `OLLAMA_ORIGINS=*` —
an unauthenticated model, open to the internet, on somebody else's compute
budget. The cause was an `override.conf` from a previous install that survived
the uninstall and won on alphabetical load order over the drop-in written to fix
it. It is now `zz-loopback.conf`, sorted last on purpose, and the old file is
kept disabled beside it. Verified from the public address: connection refused.

### Listening: `transcribe` and `shazam`

Both are local. `transcribe` runs **faster-whisper** (the `small` model, int8, on
cpu) and `shazam` runs **shazamio**, in a virtualenv at `/opt/trap-py` with a
helper at `tools/audio.py` that prints one json object. Audio is pulled with
yt-dlp — twelve seconds of it for `shazam`, which is all Shazam wants.

⚠️ **The voice-activity filter throws away singing.** `vad_filter=True` is tuned
for speech over silence, and on music it drops every segment — the transcript
comes back **empty with no error**, which reads as "nothing was said" rather than
as a setting. It is off.

⚠️ **These will not install into Debian's python.** `pip install faster-whisper`
wants to remove a system `click`, and shazamio needs a Rust toolchain. The
virtualenv is on **3.13, not 3.14**, because the audio wheels lag the newest
release, and shazamio additionally needs `audioop-lts` since 3.13 removed
`audioop` from the standard library.

### Discogs, and what it will not do without an account

`discog search` and `discog profile` need no key at all: the release database and
public profiles are both open. `login`, `logout`, `collections` and `wantlist` are
per-person and need OAuth against a registered Discogs app plus somewhere public
to send people back to, so they are **not registered** — asking for one says why
rather than failing.

### wikiHow has no search left

Every `api.php` action — `opensearch`, `query/search` — now answers with a block
page instead of json, and the search page itself comes back as a stub with no
results in the html. What still works is that **a wikiHow title is its url**:
"Tie a Tie" lives at `/Tie-a-Tie`. So the article is guessed from the words, with
their small-word casing rule and a couple of fallbacks, and `wikihow` with no
question returns a random article.

⚠️ **A wrong guess is not a 404.** wikiHow serves a bot-challenge page with a
**200** for a title that does not exist, so a miss is identified by what the page
calls itself rather than by its status code. Checking the status would treat
every miss as a hit.

⚠️ **Meta tags are not written in a fixed attribute order.** Some of their pages
put `content` before `property` and some after; matching only one way round
returns nothing and every article ends up titled "wikiHow".

## Roleplay

A cog of its own, and **off in every server until an administrator turns it on**.
**63 commands**: sixty-two reactions, plus the setting that gates them.

```
,roleplay              where the server stands
,roleplay enable       all sixty-two, for everybody here
,roleplay disable      they stay registered and decline
```

```
affection  airkiss celebrate cuddle handhold happy hug kiss love nuzzle pat
           smile wave wink yay
playful    bite bleh drool lick nom nyah peek pinch poke smug tickle woah
rough      angrystare evillaugh headbang mad punch shout slap smack
feelings   confused cry facepalm nervous pout sad scared shrug shy sigh sleep
           sneeze sorry surprised sweat tired yawn
gestures   brofist cheers clap cool dance laugh sip slowclap stare thumbsup yes
```

Each takes a member and posts a line and a gif — `,hug @someone` reads
"**you** hugs **them**" with a hug gif under it.

⚠️ **Off is the default, and a database that will not answer keeps it off.** A
server that has never heard of these should not suddenly grow sixty-two
commands, so the setting fails closed rather than open: a failed lookup returns
the last known answer or `false`, never `true`. The state is cached for a minute
because it is read before every one of these commands.

⚠️ **Only the target is pinged.** Both names are written as mentions so they
render as names, but `allowed_mentions` names only the target — the sender does
not get pinged for their own command, and aiming one at yourself pings nobody at
all. Rendering and notifying are separate things in Discord, which is what makes
this work.

⚠️ **Two of these names already belonged to a subcommand** — `celebrate` to
`birthday` and `love` to `lastfm`. The same rule as the information cog applies:
`lookup` checks the top-level registry before the group namespaces, so `,love` is
now the roleplay command while `,lastfm love` still loves the playing track. That
is a real change for anybody who typed `,love` bare to scrobble a love.

### Where the gifs come from

[otakugifs.xyz](https://api.otakugifs.xyz), which needs no key and whose reaction
list happens to be a superset of this one — every one of the sixty-two was
checked against it and returns a gif from its own category.

⚠️ **nekos.best cannot be used from this box.** It sits behind a Cloudflare
challenge that answers a plain request with an interstitial page rather than
json, the same wall the reposter hits on TikTok. It is not a rate limit and
waiting does not fix it.

⚠️ **A dead cdn must not eat the command.** If the gif service does not answer,
the line still posts without a picture. A reaction command that says nothing
because somebody else's cdn is down is worse than one without a gif.

Requests are pooled rather than made one per invocation: four are fetched at
once, one is used and the rest answer the next few calls, which is also what
stops the same picture coming back twice in a row.

## Bot appearance

```
,customize                  what it looks like here
,customize avatar <url>     its avatar in this server
,customize banner <url>     its banner in this server
,customize bio <text>       its bio in this server
```

**Server Owner.** These change the bot **in one server only** — every other server
keeps seeing its usual face. Any of the three takes `clear` to put it back.

⚠️ **Discord rations avatar and banner changes hard.** Change one twice in quick
succession and the next attempt comes back `AVATAR_RATE_LIMIT` or
`BANNER_RATE_LIMIT` — not a rate-limit response with a retry time, but a `400` that
looks like a malformed request. The command reads that code and says so plainly,
because "that did not work" would send somebody hunting for a broken image.

⚠️ **Discord will accept a bio and never give it back.** The PATCH succeeds and
even echoes the bio in its response, but the member object a bot may read carries
only `nick`, `avatar` and `banner`, and the profile endpoint answers `Bots cannot
use this endpoint`. So the bio is stored here as well, and `,customize` shows the
last one set through the command rather than pretending to know what Discord holds.

⚠️ **The link is fetched by the bot, from a box that also runs a database and a
web server.** Without a guard, `customize avatar http://127.0.0.1:8730/...` turns
the bot into a way to read them. The host is resolved first and refused if it
lands on loopback, a private range, link-local or carrier NAT, and redirects are
refused outright rather than followed somewhere that check already rejected. Only
png, jpg, gif and webp are accepted, up to 8MB.

## Suggestions

```
,suggest <your idea>              anyone
,suggest set #channel             where suggestions go
,suggest config                   the whole setup
,suggest reactions 👍 👎          the two vote reactions
,suggest threads on               a thread per suggestion
,suggest review on                hold suggestions for approval
,suggest review channel #channel  where they wait
,suggest ignore @someone          keep a member or role out
,suggest ignore list              who is kept out
,suggest lock / unlock            close and open submissions
,suggest approve <id>             Approved
,suggest deny <id>                Denied
,suggest consider <id>            In Consideration
,suggest progress <id>            In Progress
,suggest reset <id>               back to Pending
,suggest reply <id> <comment>     a staff reply on the card
```

**Anyone can suggest.** It is posted to the suggestion channel as a numbered card
with an upvote and a downvote already on it:

```
### Suggestion #1 · Pending
a dark mode please
-# from @someone
```

Staff move it between the five statuses, and can attach a reply which appears on
the card as a quote. **Setting up needs Manage Channels; moving a suggestion needs
Manage Messages** — the spec called that "staff only", and Manage Messages is the
permission a server already gives the people who handle this sort of thing.

⚠️ **The card is edited, never reposted.** A status change rewrites the message in
place, so the votes cast on it and the thread hanging off it both survive. A
reposted card would reset the count to zero every time somebody changed its state.

⚠️ **Numbers come from the database, not from counting rows.** Two people
suggesting in the same moment would otherwise be handed the same number, and the
number is how every other command finds a suggestion. The id and the increment
happen in one statement.

### Review

With `review on` a new suggestion waits in the review channel instead of going
straight up, and **it is `approve` that publishes it** — moving it into the public
channel, adding the votes and the thread there. Denying it leaves it where it is.
That way approval means something rather than relabelling a card nobody can see.

Review with no review channel set is refused with a sentence saying so, rather
than silently swallowing every suggestion.

### Ignoring

`suggest ignore` takes a member or a role and is a **toggle** — there is no
unignore command in the set, so naming somebody already ignored puts them back.
`suggest ignore list` shows who is on it.

## Reposter

⚠️ **Switched off.** The cog is untouched but not registered, so it has no
commands, no help entry and no message hook. One commented line in
`cogs/config/index.ts` brings it back. Everything below still describes it, and
the parts worth knowing before picking it up again are the CAPTCHA and the
rewrite hosts.

```
,reposter on / off
,reposter embed on      name who posted the link
,reposter strict on     match a link anywhere in a message
,reposter suppress on   hide the original preview
,reposter delete on     remove the original message
,reposter prefix on     only repost after a server prefix
,reposter container on  draw the repost inside a container
```

**Manage Server.** When somebody posts a link from one of the sites below, the
bot **downloads the video and posts the file**, captioned with the title, the
uploader, and whichever engagement counts that site reports. Every count is
labelled with its own icon, and one the site does not report is left out rather
than shown as zero — tiktok gives shares, youtube does not:

```
**what started on TikTok grew into a special…**
-# tiktok · 👁️views: 195.7K · ❤️likes: 3.8K · 💬comments: 1.2K · 🔁shares: 418
-# posted by @someone
[video.mp4 — 10MB]
```

That runs on **yt-dlp**, installed at `/usr/local/bin/yt-dlp`, with **ffmpeg** and
**curl_cffi** alongside it. All three are runtime dependencies of this feature and
nothing else; without yt-dlp the reposter still works, it just falls back to links.

### What each site actually does

Measured from this box rather than assumed, because the answers were not the ones
expected:

| | sites |
| --- | --- |
| **Downloads the video** | youtube, tiktok, instagram, x, snapchat, tumblr, pinterest, twitch, streamable, medal |
| **Downloads the audio** | soundcloud, as an `.m4a` |
| **Downloads through a fixer** | reddit via `vxreddit.com`, tiktok via `tnktok.com` |
| **Pages the photos instead** | tiktok photo posts, via `tnktok.com` |

⚠️ **ffmpeg is required, not a quality nicety.** Youtube no longer serves a
combined video-and-audio format at all — every format is one or the other — so
without ffmpeg to join them every youtube download fails outright with
`Requested format is not available`. That is why youtube looked broken while
tiktok worked.

⚠️ **Impersonation is what makes tumblr answer.** Without `curl_cffi` installed,
tumblr closes the connection on this address. yt-dlp is asked to impersonate
Chrome, but only after checking that impersonation is actually available —
requesting it when the library is missing fails *every* download, so the check
happens once and the answer is reused.

**Reddit answers this address with `403`**, and **tiktok now answers it with a
CAPTCHA** — 398KB of challenge page, on every video, with or without browser
impersonation, on both the stable and nightly yt-dlp. Neither is an extractor
problem and neither is fixable from here: the address is the thing being refused.

When a site refuses like that, the rewrite hosts are asked instead, and they
answer from their own addresses. Two details make that work:

- ⚠️ **Download the file the fixer advertises, not the fixer's page.** These hosts
  serve OpenGraph tags to a crawler and redirect anything that looks like a
  browser back to the original site — which is where the block is. yt-dlp
  impersonates a browser, so pointing it at the page walks it straight into the
  CAPTCHA. The `og:video` url is a plain mp4 and downloads fine.
- ⚠️ **No single host has both halves.** `tnktok.com` serves the file but publishes
  no counts; `tiktxk.com` publishes `❤️ 186.4k 💬 1.1k` but its video url answers
  `403` here. So the file comes from one and the numbers from the other, and only
  in this path, which is already the slow one.

Those numbers come from the OpenGraph tags the fixers publish for Discord's own
crawler — `⬆️ 14493 | 💬 448` and the like — read back into the same shape a
yt-dlp probe returns, so the rest of the code cannot tell which one answered.

Setting `YTDLP_COOKIES` to a Netscape cookie file makes private instagram posts
work too. Nothing else needs it.

⚠️ **The size a probe reports is not the size you are about to download.** Youtube
says `232MB` for a video this downloads at `20MB`, because that figure describes
the best format on offer and not the 720p one actually requested. Checking it
against the upload limit rejected every youtube link before it was ever tried.
The ceiling is enforced during the download instead, where it means something.

⚠️ **Read back the file you asked for, not whatever is in the directory.** yt-dlp
leaves each stream beside the merged result as `video.f251.webm` and the like, so
taking the first file in the folder posts an **audio-only fragment as a video**
whenever a merge fails. Only a name with a single extension is accepted.

The format ladder is built from the server's own upload limit, so a small server
gets 480p or 360p rather than nothing. If even the smallest will not fit, nothing
is posted — which is the honest outcome, and better than a soundtrack.

**Gofile is absent on purpose.** yt-dlp has no extractor for it, and its own API
needs a scraped website-token on top of a guest token. Matching the link and then
doing nothing would be worse than leaving it alone.

### The container

```
,reposter container on    the whole repost is drawn inside a container
,reposter container off   no container, no box, just the video or the photos
```

On by default. With it on, a video goes out as a Components V2 container holding
the caption and the video, and a photo post is boxed the same way, so reposts
match the rest of the bot. With it off, a video is a plain message with an
attachment exactly as before, and a photo post keeps its pages and buttons but
loses the box around them.

⚠️ **The link fallback is always plain, whatever this is set to.** A Components V2
message has no `content` for Discord to unfurl, and the entire point of falling
back to a link is that Discord turns it into a player. Boxing that would produce a
tidy container with a dead link in it.

⚠️ **With the container on there is no attachment to right-click.** The file is
consumed by the media gallery, so `message.attachments` comes back empty and the
video is a component instead. It plays the same; it is worth knowing if something
downstream reads attachments.

### Short links

`tiktok.com/t/ZP8vEyVef`, `vm.tiktok.com/…` and the rest are followed before
anything is decided, because a short link says nothing about what it points at.
The same tiktok short link can land on a video or on a photo post, and those need
completely different handling — one is downloaded, the other is paged. Everything
after the redirect works on where it landed, including which rewrite host applies.

### Photo posts

A photo post is not a video, and yt-dlp answers `Unsupported URL` for one. The
images are reachable only as the repeated `og:image` tags a fixer publishes, so
for tiktok they come from `tnktok.com` — the one place measured to list them.

They are posted as **pages with Back / Next / Page / Close**, reusing the same
pager the rest of the bot uses, so a twelve-photo post is one message rather than
twelve. Nothing is downloaded and nothing is attached: the images stay public URLs
that Discord fetches itself, which is also why an album costs no upload quota.

⚠️ **Only the person who posted the link can turn the page.** That is the pager's
own rule everywhere in the bot, and it applies here too — a stranger clicking Next
is told the menu belongs to someone else, rather than changing what everyone is
looking at.

**Photo posts carry the same counts as videos**, but the photos and the numbers
come from different places. The fixer lists the images and publishes no numbers
at all; yt-dlp refuses a photo post outright — yet it answers happily for **the
same id asked for as a video**, which is where the counts turn out to live. The
post is fetched twice, once for each half.

Tiktok is the only site with a photo route today. Instagram's fixer published no
`og:image` for any carousel tried against it, so its photo posts are not claimed
rather than claimed and left blank.

**When the download cannot happen, it falls back to posting the rewritten link**
so Discord plays it inline instead — with the same counts on it, so a repost reads
the same whether the file made it through or not. That happens when a site refuses the extractor,
the video is over the upload limit, or yt-dlp is missing. A reposter that goes
silent whenever an extractor breaks is worse than one that posts a link that
plays, and extractors do break — these sites change deliberately to stop them.

⚠️ **A video over the upload limit is re-encoded to fit, not abandoned.** The
limit is per server — 10MB unboosted, 50MB at level 2, 100MB at level 3, and the
bot takes 90% of whichever applies. On an unboosted server almost everything is
over it: a tiktok two percent above the line used to be thrown away and replaced
with a link. Now ffmpeg squeezes it to fit, which takes about ten seconds for a
two-minute clip and a minute for a four-minute one. Anything longer than **ten
minutes** is left alone, because the bitrate it would need looks like a slideshow,
and anything over **45 minutes** is never fetched at all.

⚠️ **`--max-filesize` does not mean what it looks like.** It is checked per stream
and not on the merged result, and a `filesize_approx<?` format filter admits
formats whose size is unknown. Between them, an attempt that asked for nine
megabytes hands back twenty-one. The file that arrives is measured on disk rather
than trusted, whichever attempt produced it.

Two costs worth stating plainly. **yt-dlp needs updating** — when tiktok or
youtube changes something, extraction breaks until it is updated, and that is a
standing maintenance task, not a one-off. And the fallback sends the link through
a **third-party host**, and those die constantly: `ddinstagram.com` stopped
resolving, `rxddit.com` began answering `502`, `vxtiktok.com` was taken down by a
legal request, and `kkinstagram.com` stopped serving video tags — all within a
week. That is the whole argument for `sites.ts` being one table to edit rather
than a rule spread through the code, and the reason a repost now squeezes a file
to fit before it ever considers posting a link.

**Instagram has no working rewrite host at all**, so a failed instagram download
leaves the poster's own link alone rather than replacing it with a dead one.

`strict` off means the message has to be **nothing but the link**, so a link
mentioned in passing does not drag a video into the channel. `prefix` on means
only `,<link>` is reposted, for servers that want it opt-in per message. There
is a three second cooldown per person per channel.

⚠️ **A profile link is not a video.** Short-link hosts get their own entry in the
table for exactly this reason: `clips.twitch.tv/abc` is a clip but
`twitch.tv/somestreamer` is a channel, and one greedy pattern covering both would
have the bot download strangers' profiles. Tumblr needs the opposite treatment — every blog is its own
subdomain, so no list of exact hosts can cover it and it matches on a suffix.

Downloading takes seconds, so the handler is **not awaited**: `emitMessage` runs
handlers in order, and waiting would hold up the filter and everything after it
for every link somebody posts. At most two downloads run at once, each into a
temp directory that is removed whether or not it succeeded. Progress output is
switched off — a long download otherwise writes thousands of progress lines, and
enough of them overruns the read buffer and kills the process.

`,disableevent #channel reposter` switches it off in one channel.

## Fake permissions

```
,fakepermissions add @Moderator manage_messages
,fakepermissions remove @Moderator manage_messages
,fakepermissions list [@Moderator]
,fakepermissions reset
```

**Server Owner only.** A fake permission lets a role use commands the bot gates
behind a Discord permission, without that role holding it on Discord.

Grantable: `manage_messages`, `manage_channels`, `manage_guild`, `manage_roles`,
`manage_webhooks`, `administrator` — exactly the set the bot's own gates check.
Granting something it never checks would be a lie.

⚠️ **This changes what the bot allows and nothing else.** A role given
`manage_messages` can run `,pin`; it still cannot pin by hand, delete a channel,
or do anything at all outside the bot. The real Discord permission is untouched,
and verified untouched in the tests.

⚠️ **Ownership is not a permission bit, so it cannot be faked.** Every gate goes
through `holds()`, which consults the granted bits — except `requireOwner`,
which compares against the guild's `owner_id` directly. A role granted a fake
`administrator` opens every other gate in the bot and still cannot run
`,fakepermissions`, which is the whole point: a permission that could hand out
more of itself would not be a permission, it would be a ladder.

`@everyone` is refused, because granting it there hands the permission to
everybody in the server, which is never what somebody means.

## Webhooks

```
,webhook create announcements       make one in this channel
,webhook list                       every webhook here
,webhook send <id> hello            post through it
,webhook send <id> {title: Notice}  post an embed
,webhook edit <link> <message>      rewrite what it posted
,webhook lock <id> / unlock <id>
,webhook delete <id>
```

**Manage Webhooks**, except `list`. Up to 25 per server. Each one gets a short
id, and that id is what every other command takes.

⚠️ **A webhook URL is a password.** Anyone holding it can post as that webhook,
in that channel, with no authentication and no audit trail. So the URL is never
printed and **the token is never stored** — there is no column for it. When a
send needs one, it is fetched from Discord at that moment and dropped
immediately. A leaked database row gives an attacker nothing but an id.

`send` takes plain text, or page code (`{title: ...}{description: ...}`) for an
embed, sharing the parser with the pin archive. Mentions are pinned to
`parse: []`, so a webhook cannot be used to ping a role.

`lock` keeps a webhook to the person who locked it, and **all five ways in
refuse**: send, edit, lock, unlock and delete. A lock that only guarded `send`
would be no lock at all, since anyone could delete the webhook out from under it.

`edit` only works on messages one of these webhooks posted, which is Discord's
rule rather than mine — a webhook can only edit its own output.

**A webhook deleted on Discord leaves a record you can still remove.** `send`
says it is gone rather than failing opaquely, `list` marks it *deleted on
Discord*, and `delete` still clears the row — so the bookkeeping can never get
stuck holding an entry with nothing behind it.

## Pin archive

```
,pins channel #archive     where archived pins go
,pins set on               archive automatically at 45 pins
,pins unpin off            keep them pinned after archiving
,pins archive              archive this channel now
,pins config / reset
```

**Manage Server**, and in the Configuration cog, because unlike `,pin` this is a
per-server system you set up once and leave running.

**Discord caps a channel at 50 pins**, and the archive is what you do when it
fills. `pins archive` copies the pins into the archive channel oldest first, ten
to a card with author and jump link, then unpins them unless you turned that off.
`pins set on` does the same by itself once a channel reaches 45, off Discord's
own pin-update event — 45 rather than 50 so there is room to pin one more while
it works.

Archiving a channel into itself is refused, and so is enabling the automatic
side before an archive channel exists — a switch that cannot do anything is
worse than one that says why.

## Server look

```
,seticon <url>
,setbanner <url>
,setsplashbackground <url>
```

**Manage Server.** The image is fetched by the bot and handed to Discord as a
data URI, capped at 8MB, PNG/JPEG/GIF/WebP only, and only a banner may be
animated.

⚠️ **The bot is what does the fetching, so the link is checked before anything
is requested.** Loopback, private ranges, link-local, multicast, bare hostnames
and URLs carrying credentials are all refused — otherwise `,seticon` becomes a
way to make the bot fetch `127.0.0.1:8730` or the Postgres port and report what
came back. `checkImageUrl` in `helpers/imageurl.ts` is that gate, shared with
the Last.fm artwork commands.

A banner needs boost level 2 and a splash background level 1. Both are checked
against the server's own features first, so the answer is a sentence rather than
a raw API rejection.

## Ignore

```
,ignore @someone           switch a member on or off
,ignore add #spam          ignore a channel
,ignore remove @someone    stop ignoring
,ignore list               everything ignored here
```

**Administrator**, because unlike `,disablecommand` this silences the bot rather
than narrowing it. Up to 200 per server.

An ignored member or channel is skipped **entirely**, not just for commands:
none of the things that happen without being asked run either, so no
autoresponder, no bot-side filters, no sticky repost, and nothing recorded for
`,snipe`. The check sits in front of `emitMessage`, so a feature added later is
covered without knowing this exists.

⚠️ **Ignoring the channel you are standing in must not be a dead end.** The
`ignore` commands keep answering inside an ignored channel — they are the one
exception the dispatch makes — so the way out is always where you are. Every
other command stays silent there.

Running it bare on a member or channel toggles, which is the common case; `add`
and `remove` are there for when you want to say exactly what you mean.

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
`filter`, `gallery`, `snipe`, `sticky`, `reactions`, `reposter`, `editrerun`,
`welcome`, `goodbye` and `boost`. Eleven of them.

Ten are enforced in `core/hooks.ts` rather than in each feature: a handler
registers with a name (`onMessage(police, "filter")`), and the emitter skips a
named handler whose event is off in that channel. One check covers every feature
that rides a hook, including ones added later, instead of each of them
remembering to ask. `editrerun` is the exception, because it is not a hook at
all: it is checked where `messageUpdate` decides whether to dispatch.

⚠️ **The commands that switch things back on can never be switched off.** A
server that disabled `,enablemodule` in every channel would have no way back
short of a database edit. `PROTECTED` in `core/availability.ts` holds them, and
the gate ignores a rule naming one even if a row somehow exists — so a stale row
cannot lock anyone out either.

Only whole commands can be disabled, not their subcommands: `,filter caps` says
so and points at `,filter`. The gate runs at dispatch, where only top-level
commands arrive, so a promise to disable a subcommand would be one the
enforcement could not keep.

`copydisabled` reports what it found as well as what it wrote, because "nothing
is switched off there" and "all of it was already switched off in the target"
are different answers and the first one is a lie about the server's own
configuration.

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

These commands page **messages the bot has already sent**. The same Back / Next /
Page / Close buttons also appear on a paged photo repost and on any long listing,
because all three sit on `core/pager.ts` — but those are built as they are posted
and are not managed from here.

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

`,filter` is ten filters behind one command, 35 commands in all.

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

## Server tag

```
,badge on / off             reward people who wear the server tag
,badge channel #channel     where new wearers are announced
,badge role                 the roles awarded
,badge role add @role       add one
,badge role remove @role    remove one
,badge role list            all of them
,badge sync                 settle everybody's roles now
,badge message <text>       what the announcement says
,badge message view         read it back
```

**Manage Server.** Discord lets somebody wear one server's tag on their profile
and reports which one on the **user** object, as `primary_guild`, alongside the
member list. Anybody wearing this server's gets the configured roles and one
announcement; anybody who takes it off loses them again.

⚠️ **Wearing a tag is not wearing yours.** `identity_guild_id` has to match this
server *and* `identity_enabled` has to be true. Six members here wear a tag — all
for a different server — and none of them are awarded anything. Checking only that
the field exists would have handed roles to all six.

⚠️ **Roles are taken back, not only handed out.** A reward nobody can lose is a
role handout with extra steps, so a sweep removes the roles from anybody who has
stopped wearing it, and forgets them so putting it back on is thanked again.

⚠️ **A role above the bot is refused when it is added**, not when it is used.
Discord will not let the bot grant a role sitting higher than its own, and finding
that out during a sync means one silent failure per member with nothing to read.

`sync` settles everybody at once and **announces nobody** — it is what to run
after changing the role list, without pinging half the server. The announcement
takes the same `{user}` and `{guild}` tokens the greetings use.

Verified against a real wearer: the tag reads as
`{identity_guild_id: <this server>, identity_enabled: true, tag: "ping"}`, the role
lands, the announcement goes out once and not twice, and a second sweep with
announcing switched on stays quiet.

**Awarding is automatic.** Discord does send `GUILD_MEMBER_UPDATE` when somebody
puts a tag on — confirmed by watching the raw gateway while the tag was toggled,
nine of them inside six seconds — and the bot gave the role and posted the
announcement on its own, six seconds after the toggle, with nothing run by hand.

`badge sync` is still worth having: it settles everybody at once after the role
list changes, and it covers anyone whose change was missed while the bot was
restarting.

## Command limits

Every command runs through one limit, so nobody can hold the bot down by holding
down a key:

```
,ratelimit                on or off, and what it is set to
,ratelimit user 5         commands one person may run in the window
,ratelimit server 30      commands the whole server may run
,ratelimit window 10      seconds the two are counted over
,ratelimit reset          back to the defaults
```

**Manage Server**, and every server sets its own. The defaults are five per person
and thirty per server every ten seconds — more than anyone types by hand and far
less than a script manages, so a normal conversation never touches it.

⚠️ **The two numbers have to make sense together.** A per-person limit above the
server ceiling can never be reached, and a ceiling below the per-person limit lets
one person exhaust it and leave everyone else refused for a reason they are never
told. Either way round the command says so and changes nothing.

`user` accepts 1-60, `server` 5-1000, `window` 3-120 seconds. `ratelimit off`
removes the limit entirely, which is the server's business but leaves nothing
between the bot and somebody holding down a key.

⚠️ **Somebody over the line is told once, then dropped in silence for 30 seconds.**
Answering every command in a flood makes the bot the loudest thing in the channel
— it would be doing the spamming on the spammer's behalf. One sentence, then
nothing. If they keep going for a full minute they are told twice, not sixty times.

⚠️ **Stopping is not punished.** The window is a sliding one, so somebody who
pauses long enough to fall back under the limit is served normally again, even
inside the quiet spell. The quiet spell only suppresses the *warning*.

**The server ceiling is separate**, so twenty accounts arriving at once are
stopped even though each is under their own limit. Whoever trips that ceiling is
never told why: it is usually not about them, and explaining it to each of twenty
raiders is twenty more messages.

Direct messages are judged per person only — a shared bucket there would let one
person silence strangers.

Nothing here touches the database. It runs for every message that looks like a
command, and the message path does no I/O. The counters live in memory and are
pruned once they pass five thousand tracked keys.

The settings are read through the same provider inversion the ignore and
availability gates use: the cog owns the table and the cache, `core/throttle.ts`
knows only how to ask. A server that has never touched it, and a database that
cannot be reached, both fall back to **the defaults rather than to no limit** —
an unreachable database is a reason to keep the guard, not to drop it. Custom commands go
through the same limit, and so does a command re-run by editing a message, since
both take the same dispatch path. `/help`, the one slash command, does not.

⚠️ **This covers commands, and several features are not commands.** The reposter
fires on somebody posting a link, the autoresponder on somebody saying a word, and
the filter, sticky, gallery and snipe hooks on any message at all. None of those
begin with a prefix, so none of them reach this limit — which is why they keep
their own cooldowns: **four seconds** per trigger per channel for the
autoresponder, **three** per person per channel for the reposter, **1.2** for a
re-run edit. The two layers guard different doors rather than doing the same job
twice.

## Run

1. Put the bot token in `.env` (`DISCORD_TOKEN=...`).
2. `npm install && npm run build`
3. `pm2 start ecosystem.config.cjs && pm2 save`

### Seven things npm will not install

Some commands shell out to programs that are not node packages, so `npm install`
does not bring them and a fresh box does not have them. The bot starts either
way — it just does less the more of them are missing, which is the failure mode
to know about, because none of them announce themselves.

| | what it is for | missing it costs |
| --- | --- | --- |
| **yt-dlp** | fetching video and audio | reposts degrade to links; `makemp3`, `transcribe` and `shazam` stop |
| **ffmpeg** | joining video and audio, and the image filters | youtube, twitch and reddit fail outright; `rotate`, `invert`, `compress` and `hex` stop working |
| **curl_cffi** | letting yt-dlp impersonate a browser | tumblr refuses the connection |
| **Chrome** | rendering a page for `screenshot` | `screenshot` alone; nothing else notices |
| **Piston** (docker) | running code in a sandbox | `run` says the runner did not answer |
| **/opt/trap-py** | faster-whisper and shazamio | `transcribe` and `shazam` |
| **Ollama** | the model behind `ask` | `ask` says the model is not running |

```
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp
apt-get install -y ffmpeg
pip3 install --break-system-packages curl_cffi

curl -L https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
apt-get install -y /tmp/chrome.deb
useradd --system --create-home --shell /usr/sbin/nologin trapshot

# loopback only: this runs code a stranger typed
docker run -d --name piston_api --restart=always --privileged \
  -v /opt/piston/data:/piston -p 127.0.0.1:2000:2000 \
  -e PISTON_RUN_TIMEOUT=10000 -e PISTON_COMPILE_TIMEOUT=20000 \
  ghcr.io/engineer-man/piston
# then POST each language to /api/v2/packages

# 3.13, not 3.14: the audio wheels lag the newest release
python3.13 -m venv /opt/trap-py
/opt/trap-py/bin/pip install faster-whisper shazamio audioop-lts

curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b
```

⚠️ **Three of these listen on a port, and every one of them must stay on
loopback.** Piston runs code somebody typed into Discord; Ollama is an
unauthenticated model that anybody who finds it can spend the box's cpu on.
Ollama in particular **binds to `0.0.0.0` by default**, and on this box a
`override.conf` from an older install put it back there after being fixed —
drop-ins load alphabetically and the last one wins, so the fix is named
`zz-loopback.conf`.

⚠️ **Ubuntu 26.04 has no Chromium deb.** `apt-get install chromium` resolves to a
snap, which does not run headless under this setup, so Chrome's own deb is what
is installed. `chromium-browser` in the archive is only a shim pointing at that
snap — it looks like a package and is not one.

⚠️ **ffmpeg is not optional for youtube.** Youtube serves no combined
video-and-audio format any more, so without something to merge the two streams
every youtube download fails on `Requested format is not available` — while the
metadata still comes back perfectly, which makes it look like a network problem
rather than a missing program.

⚠️ **yt-dlp goes stale.** Sites change specifically to break extractors, and when
one does, that site quietly falls back to links until `yt-dlp -U` is run. It is a
standing task, not a one-off.

`YTDLP_PATH` overrides where the binary is looked for. `YTDLP_COOKIES` points at a
Netscape cookie file, which is what private instagram posts need.

## Deploy

```
python deploy/deploy.py              upload what changed, build, restart
python deploy/deploy.py --dry-run    say what would go, change nothing
python deploy/deploy.py --status     what pm2 thinks is running
python deploy/deploy.py --logs 40    tail the bot log
```

```
node --env-file=.env deploy/docaudit.mjs    check the docs against the registry
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

`docaudit.mjs` reads the numbers **out of** these two files and compares them to
the live registry, rather than being told what to expect. A check that
hard-codes the expected value passes while the prose is still wrong — which is
how "240 subcommands" survived two audits, since updating the check and updating
the sentence are separate acts and only one of them happened. It exits non-zero,
so it can gate a deploy.

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
colliding on option value, which killed 18 of the browser's views at once.

Two consequences of having no `content`, both found by building on it:

- ⚠️ **A V2 message does not unfurl links.** There is no `content` for Discord to
  read, so a link inside a text component stays text. Anything that depends on
  Discord turning a link into a player — the reposter's fallback — has to be sent
  as a plain message, whatever the surrounding feature is set to.
- ⚠️ **A file shown by a component is not an attachment.** Upload a file and point
  a media gallery at `attachment://name`, and Discord moves it into the component:
  `message.attachments` comes back **empty** and the media carries a CDN url
  instead. It plays identically, but anything reading attachments — including a
  test asserting on `content_type` — sees nothing.

### Uploading a file

`write()` JSON-encodes its body, which cannot carry bytes. An upload has to be
`multipart/form-data` with the message itself in a `payload_json` part and the
bytes in `files[0]`, which is what `sendFile` in `core/discord.ts` does. It takes
`components` and `flags` as well as `content`, because a file can be posted either
plainly or inside a container and the two are the same request with a different
payload.

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
within a group, and with 442 subcommands `exempt`, `list`, `add` and `remove`
each belong to a dozen owners. Every id, option value and lookup carries the
full path (`filter caps exempt list`), resolved by `lookupPath()`. `,help` takes
a path too, so `,help filter links whitelist` opens that exact command.

The check that keeps this honest renders **all 920 views** and asserts unique
option values, unique ids, 25 options, 4000 characters and 5 rows per view, then
posts the ones that changed to a real channel. Space those posts out: Discord
answers a burst with 429s that read exactly like component failures.


⚠️ **Two catalog entries must never share a slug.** `sectionsOf` matches by slug,
so a slug used twice puts the **same value in a select menu twice** — and Discord
refuses the whole message, which means clicking that cog in the help browser does
nothing at all. It is silent on the way in: nothing throws, nothing warns, and
the cog that already owned the slug breaks too. `miscellaneous` reusing
moderation's `history` broke both of them, and the view count was quietly
inflated by eight because the shared section was counted once per cog.

`docaudit` now renders every view and fails on a repeated option value, which is
what the paragraph above always claimed it did and did not.
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
