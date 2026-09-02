# Trap

Prefix-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno)
(TypeScript strict, Node 22), run bare with pm2. 641 commands across four cogs,
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
- `,prefix` — what this server answers to
- `,boosterrole` — personal colour roles for boosters
- `,welcome`, `,goodbye`, `,boosts` — messages posted when someone joins, leaves or boosts
- `,alias` — server shortcuts for existing commands
- `,stickymessage` — keep a message at the bottom of a channel
- `,imgonly` — make a channel take images only
- `,confessions` — anonymous confessions submitted through a button
- `,counting` — a counting game in a channel
- `,counter` — channels whose name is a live figure
- `,button` — buttons on a message that answer whoever presses them
- `,buttonrole` — roles members give themselves by pressing a button
- `,dropdownrole` — roles members pick from a menu
- `,autorole` — roles handed out to members as they join
- `,autothread` — a thread started on every message in a channel
- `,autoresponder` — automatic replies when a message matches a trigger
- `,pagination` — several pages behind one message, turned with arrows
- `,disablecommand` — turn commands, modules and events off per channel
- `,events` — the same for events, in the grammar people expect
- `,ignore` — members and channels the bot reads nothing from
- `,pins` — flush a channel's pins into an archive channel
- `,seticon`, `,setbanner`, `,setsplashbackground` — the server's look
- `,webhook` — post as a named identity in a channel
- `,fakepermissions` — let a role use the bot without the real permission
- `,badge` — reward members who wear the server tag on their profile
- `,suggest` — members suggest ideas, staff move them through statuses
- `,customize` — the bot's look, and the emoji and colour of every card it sends
- `,automod` — ten chat filters, five of them enforced by Discord's AutoMod (was `,filter`)
- `,ban`, `,tempban`, `,softban`, `,hardban`, `,warn`, `,timeout` — punishments, each writing a case
- `,history`, `,caselog`, `,reason`, `,proof`, `,notes` — the case log and what is on it
- `,jail`, `,mute`, `,imute`, `,rmute` — holding somebody's roles, and three kinds of mute
- `,role` — twenty ways to give, take, edit and mass-assign roles
- `,purge` — twenty-one ways to clear messages
- `,lockdown`, `,unlock`, `,hide`, `,slowmode`, `,nuke` — channel control
- `,thread`, `,remind`, `,stickyrole`, `,restrictcommand`, `,raid` — the rest of moderation
- `,antiraid` — sixteen ways to spot a raid arriving and shut the door
- `,antinuke` — twenty ways to watch a server being taken apart, owner only
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

Nineteen commands.

```
,boosterrole #1db954 night owl   make or update yours
,br blue purple                  a two-colour gradient
,br dominant [@member]           the main colour out of an avatar
,br rename <name>                rename it
,br icon <url>                   set its icon
,br icon remove                  clear it
,br share @someone               let someone else wear it
,br share clear                  take it back off everyone
,br remove                       delete it
```

Admin side, all Manage Server: `base` (where new roles sit, `above` or `below`
a role of your choosing), `include` (a role that may make one without
boosting, plus `list` / `remove` / `clear`), `list`, `share limit` (how many
members may share one role), `sync` (delete the roles whose owner stopped
boosting and put the rest back where they belong) and `clear` (delete every one
of them).

⚠️ **`,color` is not an alias for this.** Last.fm already answers to it for
`,lfcolor`, and the configuration cog loads first, so claiming it here would
quietly take that command away. `,br` and `,cr` are the short forms, and
`,boosterrole color <colour>` works because the group swallows a leading
`color` rather than registering it — a word the dispatcher ignores cannot steal
a command from another cog.

**`include` opens the whole member side at once.** The check lives in
`requireBooster()` rather than in each command, so a server that includes a
role does not have to remember which member commands were updated. Roles
already made are kept when the exception is removed; `sync` is what tidies
them.

⚠️ **Four settings were removed along with the commands that set them.** The
group was cut to a supplied spec, which dropped `random`, `award`, `filter`,
`link`, `cleanup`, `limit` and the old `share limit`. Four of those were not
just commands: the server role cap, the blocked-word list for names, the
per-member share cap and the award-on-boost role were each *enforced* elsewhere
in the code. Deleting only the command would have left a server permanently
subject to a rule with no way to see or change it, so the enforcement went too.
The rows are still in the database, so nothing is lost if they come back.

⚠️ **`share limit` changed meaning.** It used to cap how many shared roles one
member could wear. It now caps how many members one role can be shared with —
what `share max` did, which is kept as its alias. A server that had set the old
one is no longer bound by it.

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

## Confessions

`,confessions` posts a panel with a button. Pressing it opens a modal, and what
somebody types is posted to the confession channel under a number, with no name
attached. Forty-six commands, all **Manage Server**, four levels deep.

```
,confessions channel #confessions     where they are posted
,confessions review #staff            hold them for approval first
,confessions log #audit               where the author IS recorded
,confessions panel                    post the submit button
,confessions cooldown 1h              one each per hour
,confessions age 7d                   no brand new accounts
,confessions filter <word>            add or remove a filtered word
,confessions settings                 everything at a glance
```

**Five things can stop a submission**, and each says which without saying
anything about anyone else's confession: the blacklist, a minimum account age, a
per-member cooldown, the word filter, and the link and image settings.

⚠️ **The account age is read out of the account's own snowflake**, so it costs
no request: a Discord id carries its creation time in its top bits.

⚠️ **The log channel is the one place the author is named.** That is the point
of it — `anonymous` only decides whether the *reviewers* see who sent it, and
without a log nobody can be traced at all. Set one before you need it.

⚠️ **A Discord modal has text inputs and nothing else.** There is no attachment
field, so `confessions images` cannot govern uploads because none can happen.
It governs image *links* instead, checked separately from the link setting so
that "links yes, images no" means something.

**The reply button runs the same gauntlet.** Replies are checked exactly as
confessions are — otherwise the reply button would be a way around every check
on the submit button. It can also be removed entirely with
`confessions replybutton remove`.

Numbers are handed out by the insert itself (`MAX(number) + 1` inside the
statement) rather than by counting rows first, so two confessions submitted in
the same moment cannot get the same number.

## Bot appearance

`,customize` changes what the bot looks and sounds like **in one server only**.
Seventeen commands, all **Server Owner**.

```
,customize avatar <attachment>       its face here
,customize display Trap Bot          its name here
,customize bio here to help          its bio here
,customize response warn ⛔ red      how a refusal looks
,customize response default 🔷 blurple
,customize ping on                   let replies mention people
,customize punctuation off           no full stop at the end
,customize reset                     all of it back to normal
```

**`customize response` gives four kinds of card their own emoji and colour.**
Two of them are visible everywhere at once: `default` is nearly every card the
bot sends, and `warn` is every permission refusal in the bot — both are applied
in `core/permissions.ts`, so no command had to opt in. `approve` and `loading`
are used by commands that report those states. Every one of them **renders its
own confirmation card in the style being set**, so what it looks like is the
answer to what it does.

`warn` also takes `soft=true`, which keeps the emoji and drops the red.

⚠️ **The style is a scope, not a lookup.** It is read once at dispatch and
carried through the command in an `AsyncLocalStorage`, next to the Last.fm
accent — one read per command rather than one per card. The command that
*changes* the style therefore starts inside the old one, which is why the
confirmation re-enters the scope before rendering: otherwise it would show what
it had just replaced.

⚠️ **`${JSON.stringify(obj)}::jsonb` stores a jsonb *string*, not an object.**
The driver sends a string parameter as a JSON string literal, so the cast wraps
it rather than parsing it: every style wrote fine, read back empty, and said
nothing. Measured three ways against the real database — `sql.json(obj)` and a
server-side `jsonb_build_object` both write an object, the cast does not.

## Counting

`,counting` runs the counting game: members count upwards, one number per
message, a tick for a correct one and a broken count for a wrong one. Seventeen
commands, all **Manage Server**.

```
,counting setup #counting             start, from 0, stepping by 1
,counting toggle #counting math       let 5+6 count as 11
,counting set lives #counting 3       absorb three mistakes
,counting set goal #counting 1000 @Counter
,counting set milestone #counting 100 {count} reached!
,counting leaderboard                 who has counted most
,counting view #counting              where it is up to
```

**Nine toggles**, each on or off per channel: `math`, `repeat`,
`deleteinvalid`, `deleteothers`, `editprotection`, `resetonfail`,
`announceresets`, `announcerecords` and `pinmilestones`. `resetonfail`,
`announceresets` and `announcerecords` start on; the rest start off.

⚠️ **`math` never evaluates anything.** Reading `5+6` from a public channel with
an evaluator would be handing a stranger a shell, so it is a recursive-descent
parser over digits and five operators. `process.exit(1)`, `require('fs')` and
`1;2` all come back as "not a number" rather than as anything at all.

**Counting twice in a row breaks the count** unless `repeat` is on — it is a
rule violation like any other, so `resetonfail` and lives apply to it too.

⚠️ **`,count` is not an alias.** Last.fm already answers to it, and the
configuration cog loads first, so taking it would quietly remove that command
from the bot. `,counting`, `,number` and `,numb` all work.

`,disableevent #channel counting` switches the game off in a channel without
unconfiguring it.

## Counters

`,counter` renames a channel on a timer so its name is always a current number.
Eighteen commands, all **Manage Server**.

```
,counter add #stats {members} members · {roles} roles
,counter youtube #subs @MrBeast
,counter twitch #live shroud
,counter preview {members|human} members     try one without making anything
,counter variables                           what a template can use
,counter socialvars                          what each platform adds
,counter refresh #stats                      update it now
```

Templates take `{tokens}`, a `|human` or `|comma` filter on any number
(`1.2K` or `1,234`), and `{if: condition && when true && when false}` — which is
how the Twitch default shows viewers while live and a link when not.

⚠️ **Discord allows two channel renames per ten minutes.** That is measured, not
documented: the third `PATCH` returns 429 with `retry-after: 600`, while the
rate-limit headers cheerfully report nine remaining on a ten-second window. A
counter that trusts those headers gets throttled and stops updating. So the
cycle is ten minutes, and a name that has not changed is never sent — which
leaves the second rename in hand for `,counter refresh`.

⚠️ **A text channel lowercases its name and turns spaces into dashes.** Counters
belong on a voice channel or a category, and the card says so when you point one
at a text channel.

**Five platforms can be read; three cannot.** Each was probed from the box
before a line was written:

| | |
| --- | --- |
| YouTube, SoundCloud, SoundCloud tracks, TikTok | read straight off the page |
| Twitch | its own public GraphQL endpoint, live state and viewers |
| Spotify | ⚠️ monthly listeners are drawn by the page's scripts and are in no API, official or otherwise |
| Instagram | ⚠️ signed out, the profile endpoints answer 400 and 429 |
| Twitter / X | ⚠️ needs a paid key; the old public widget endpoints are gone |

The three that cannot be read still have their commands, and those commands say
why rather than making a channel that never changes. `,counter socialvars` lists
the same thing.

**There is deliberately no `{humans}` or `{bots}`.** Discord's member count does
not split them, and the only way to is to walk every member — far too much work
to repeat on a timer. A wrong number in a channel name is worse than a missing
variable, because nobody ever checks a counter.

## Response buttons

`,button` puts buttons on one of my messages. Pressing one replies **only to
whoever pressed it**, so a single message can answer a whole channel without
filling it. Twelve commands, all **Manage Server**.

```
,button add <link> success ✅ Rules | be nice to each other
,button add danger 🚫 Bans | ask a mod
,button list                      every button in the server
,button style 1 primary           restyle one
,button label 1 Read this         relabel it
,button move 1 2                  reorder it
,button edit 1 <new reply>        change what it says
,button remove 1                  take it off
,button render                    put them back on the message
```

**The message is optional after the first time.** Give a link once and the
channel remembers it — derived from what is configured there, not held in
memory, so it survives a restart and two people working at once do not
overwrite each other's idea of "the message".

**In `add`, the style and emoji come first if you want them, then a `|` splits
the label from the reply.** With no `|` the whole thing is the reply, and the
button then needs an emoji to be identifiable at all. The separator is a pipe
rather than a comma because a reply routinely contains commas.

The reply takes the same variables as the greetings, filled in for **the person
who pressed**, not the person who set it up.

⚠️ **Re-rendering keeps components it did not write.** The components array is
rewritten on every change, and on a Components V2 message that array *is* the
message — replacing it wholesale would delete the text. So the message is read
back first and every row that is not ours is kept in place. That is also what
stops a paginated message losing its arrows.

⚠️ **`button clear` with no link clears the whole server.** It returns each
message's channel from the same statement that deletes the rows, because once
they are gone nothing remembers where each message lived and every re-render
would aim at the channel the command was typed in.

Twenty-five buttons per message, five to a row: Discord's ceiling, not one of
ours. A message that already has five rows of something else has no room, and
the card says so rather than letting the edit fail.

## Dropdown roles

`,dropdownrole` puts one menu on a message that hands out as many roles as you
like. Picking an option gives the role, unpicking it takes the role back, and
the answer is only shown to whoever used the menu. Eight commands, all
**Manage Roles**.

```
,dropdownrole add <link> @Reader 📚 Books
,dropdownrole description @Reader for the readers
,dropdownrole placeholder Pick your interests
,dropdownrole remove @Reader          by role, or by index
,dropdownrole render                  put the menu back
```

**The minimum selection is zero.** That is what lets somebody deselect
everything and end up with none of the roles — a menu with a minimum of one can
never give a role back.

Twenty-five options at most, which is Discord's ceiling for a select. The same
four roles are refused as everywhere else, and the hierarchy is re-checked on
every pick since the bot's role can be dragged down afterwards.

⚠️ **A select is not a row of buttons.** It sits alone in its own action row, so
the shared renderer grew `applyComponents`, which takes prebuilt rows;
`applyRows` is now the button-shaped convenience on top of it. `ours()` needed
no change at all — a select carries a custom id exactly as a button does, so it
was already recognised.

**One message can carry all three.** Response buttons (`rb:`), button roles
(`brl:`) and this menu (`ddr:`) each own the rows carrying their own prefix and
treat the rest as foreign, so re-rendering any one of them leaves the other two
alone. That is tested directly.

With no options left the row is not built at all, which is how clearing takes
the menu off the message without touching anything else on it.

## Button roles

`,buttonrole` puts a role behind a button. Pressing it hands the role over;
pressing again takes it back, and the confirmation is only ever shown to whoever
pressed. Six commands, all **Manage Roles**.

```
,buttonrole add <link> @Reader success 📚 Books
,buttonrole list                  every one in the server
,buttonrole remove @Reader        by role, or by index
,buttonrole render                put them back on the message
,buttonrole clear                 all of them, everywhere
```

The style and emoji are optional and come after the role; whatever is left is
the label, and with nothing left the role's own name is used.

**Four roles are refused rather than stored** — `@everyone`, a role Discord
manages, a role carrying Administrator, and a role above the bot's own — for the
same reason `,autorole` refuses them: each would fail on every press instead of
once at the point of setting it up.

⚠️ **The hierarchy is checked again on every press.** The bot's role can be
dragged below the role after the button is made, and then the press has to say
so rather than doing nothing.

⚠️ **This and `,button` share one renderer and can share a message.** Each
treats the other's rows as foreign and puts its own back where its own used to
be, so a message can carry both and re-rendering either leaves the other alone.
That is also what keeps a Components V2 body and a pagination control intact —
`cogs/config/button/render.ts` is the single place that knows how.

Members keep the roles they took when a button is removed; taking the button
away only stops it being handed out.

## Autorole

`,autorole` hands roles to members as they arrive. Five commands, all Manage
Roles.

```
,autorole                         what is handed out, and what is stuck
,autorole add @Member             everyone who joins gets it
,autorole add @Verified --humans  people only, never bots
,autorole add @BotRole --bots     bots only
,autorole remove @Member          stop handing one out
,autorole clear                   stop handing out all of them
```

⚠️ **It does not backfill.** Adding a role changes what happens to the *next*
member through the door; nobody already in the server is touched. Removing one
does not take it off anybody either, so a role handed out by mistake has to be
cleaned up separately.

Four things are refused rather than stored, because each would fail on every
join instead of once here:

| | |
| --- | --- |
| `@everyone` | everybody already has it |
| a role Discord manages | a bot's role, an integration's, or the booster role — nobody can assign these |
| a role with **Administrator** | it would hand the server to whoever joins next |
| a role above the bot's own | Discord's hierarchy, which no permission gets around |

A role carrying Manage Server, Manage Roles, Manage Channels, Ban, Kick or
Manage Webhooks **is** accepted, and the card names the permission so the choice
is a deliberate one.

The hierarchy is checked again when the list is shown, not only when a role is
added, because the bot's role can be dragged down afterwards — and then the
role simply stops being handed out with nothing to see. `,autorole` says so.

Ten roles at most. That is not a Discord limit but a rate-limit one: each role
is a separate request, so a join flood multiplies by however many are on the
list.

⚠️ **This needs the privileged GuildMembers intent**, the same one `,welcome`
and `,goodbye` need, because it hangs off `guildMemberAdd`. The commands and the
storage work without it; the roles just never get handed out.

## Autothread

`,autothread` starts a thread on every message in a channel. Fifteen commands,
all **Manage Channels**.

```
,autothread add #help                      thread every message here
,autothread name #help {user.display}      what the thread is called
,autothread archive #help 60               how long before it archives
,autothread slowmode #help 30              slowmode on the new thread
,autothread message #help someone will be with you
,autothread reactions add #help 👍          react to the threaded message
,autothread variables                      what a name can use
,autothread remove #help                   stop
```

The name and the opening message take **the same variables as the greetings**,
so `,autothread variables` and `,welcome variables` list the same table. The
spec's own default is `{user.display_name}`, which now works alongside
`{user.display}` — the same value under both spellings.

⚠️ **The reactions go on the message, not in the thread.** The point is to mark
the original as having one, so `,autothread reactions add` reacts to what was
posted. Five per channel, because each is its own request on top of the thread
and the message.

**The bot's own messages are skipped.** Otherwise the opening message and every
command reply in the channel would each get a thread of their own.

Two kinds of channel are refused rather than stored:

| | |
| --- | --- |
| a forum | it already makes a thread of every post |
| a thread, or anything without channel-level messages | there is nothing for a thread to hang off |

Discord allows exactly four archive lengths — 60, 1440, 4320 and 10080 minutes,
being an hour, a day, three days and a week — and rejects anything else, so the
command lists them rather than passing a number through to a 400.

⚠️ **This is the heaviest hook in the bot.** A configured channel costs a thread
creation per message, plus a request per reaction and one more for the opening
message. Twenty-five channels is the cap, and a busy channel will meet Discord's
rate limits before it meets that.

`,disableevent #channel autothread` switches it off in one channel without
unconfiguring it.

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

## Antiraid

**16 commands** watching the door rather than the furniture: the antinuke stops a
member taking the server apart, this stops the server filling up with accounts
that should not be in it. **Manage Server**, and everything off by default.

```
,antiraid                                 what is on, and what it will do
,antiraid massjoin on 1m --threshold 15   several accounts arriving at once
,antiraid newaccount on --threshold 7     accounts under seven days old
,antiraid avatar on                       nobody without a profile picture
,antiraid automation on                   accounts that look automated
,antiraid spam on 10s --threshold 8       one member flooding
,antiraid mentionspam on --threshold 6    one member mass-mentioning
,antiraid raidspam on 10s                 a channel flooded by several accounts
,antiraid channel #alerts                 where any of that gets reported
,antiraid pause 30m                       shut the door by hand
,antiraid resolve                         open it again, and wake the antiraid
,antiraid duration 30m                    how long a raid pauses invites for
,antiraid disable 1h                      switch the whole thing off for a while
,antiraid whitelist @member               never touched
```

Every module takes `--punishment kick|ban|timeout`; the counting ones also take
`--threshold` and `--duration`. The timeframe is positional as well, so
`antiraid spam on 30s` and `antiraid spam on --duration 30` mean the same thing —
the antinuke spells it `--duration`, and nobody should have to remember which
group wants which. Aliases: `warden`, `wd`.

⚠️ **`newaccount` shares the flag's name but not its meaning.** It counts days,
not events, so it declares its own `--threshold <1-365 days>` with its own
wording. Reusing the shared one advertised `<1-200>` for a bound that was really
1-365 — a card promising something the command would refuse, which is the exact
drift declaring flags exists to stop.

### Pausing invites is the only real lever

Discord has no "stop people joining" switch. What it has is a guild **feature**,
`INVITES_DISABLED`, and toggling it means reading the whole features array and
writing it back with one entry added or removed — sending a shorter list would
turn the server's other features off.

A raid pauses invites for the configured time and resumes on a timer. A second
raid while one is already paused **extends** the pause rather than starting a
second timer that would resume early.

### What "looks automated" can honestly mean

Discord does not say "this is a bot". What it does expose is its **own** opinion:
the spammer flag it sets on an account, and `unusual_dm_activity_until`. Those
sit alongside weaker signals — no avatar, made in the last day, a
generated-looking name.

⚠️ **One signal is a coincidence, so two are required.** Acting on a single one
would kick every new member who has not set an avatar yet, which is most of them.
The undocumented spammer flag is treated as one vote rather than as proof.

⚠️ **A flood is not a busy channel.** `raidspam` counts messages *and* distinct
accounts, and needs both. Two people talking quickly is a conversation; twelve
messages from six accounts in ten seconds is not.

⚠️ **`raid` is not an alias for this.** Moderation already has `,raid`, for
clearing up *after* one, and the config cog loads first — so taking the name here
silently refused the real command. A command outranks an alias.

Everything it does goes through the same protection log the antinuke uses, timed,
and `,antinuke log` shows both.

## Antinuke

**20 commands** watching for a server being taken apart, and stopping whoever
is doing it. **Server owner only** — every one of them, including reading the
settings. This is the thing that survives a moderator going bad, so it cannot be
configured by the people it exists to stop; `antinuke trust` is how the owner
delegates it deliberately.

```
,antinuke                       what is on, and what it will do
,antinuke ban|kick|channel|role|emoji|webhook <on|off> [--threshold 3] [--duration 60]
,antinuke bot|permissions <on|off>          one is already too many
,antinuke punishment <ban|kick|stripstaff|jail>
,antinuke trust <member>        may change these, and is never punished
,antinuke whitelist <user>      never punished, cannot change anything
,antinuke log                   what fired, and how long it took
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

### How long it took

Every protective action is timed, and the number is the whole response — reading
the settings, reverting a permission grant, carrying out the punishment — not
just the last call. The owner's DM ends with **acted in 318ms**, and
`,antinuke log` lists what fired with the time each took, fastest and slowest in
the footer.

The filters are in there too. They delete a message and say nothing, which is
right in the channel and useless afterwards: there was no way to tell a filter
that is working from one that is switched off, which is the first thing somebody
asks after setting one up.

⚠️ **The AutoMod-backed filters cannot be timed, because the bot never acts.**
Words, patterns, invites and links are enforced by Discord itself — the message
is gone before anything here hears about it, which is the point of using AutoMod
and the reason those five keep working while the bot is offline. Only the four
the bot enforces itself — caps, emoji, spoilers, music files and rate — appear in
the log.

⚠️ **The log is written in batches, not per action.** A filter fires on ordinary
messages, so a round trip per deleted message would be a round trip per message
during exactly the flood it exists to stop. Entries buffer for twenty seconds;
reading `,antinuke log` flushes first so it never contradicts something you just
watched disappear.

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

⚠️ **`plain()` and `label()` truncate at 180 characters.** They are built for a
name or a title, and the cut is invisible at the call site — `plain(x.slice(0,
1800))` cuts at 180, because the slice runs first and the escaper cuts again.
Nineteen call sites had it: a whole suggestion body asking for 1800 characters
and getting 180, `run` output ending mid-word, an Urban Dictionary definition
stopping mid-sentence, moderation case reasons and proof, `seen` quotes, channel
topics. All of them pass a length now, and **docaudit fails on any call site that
asks for more than the escaper gives**, because none of these looked wrong.

**Text inside a fenced code block should not go through it at all** — markdown is
not interpreted in there, so escaping only puts backslashes through somebody's
output. Containing the backticks is the whole job.

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

## Events

`,events` switches off the things the bot does that nobody typed. Six commands,
all **Manage Channels**.

```
,events                            what the events are
,events disable autothread #general
,events disable all counting       every channel
,events enable autothread #general
,events list                       where anything is switched off
```

⚠️ **This is a second door onto the same room.** `,disableevent` and
`,enableevent` already did this job, and both spellings write one table through
one store (`availability/store.ts`). Keeping a second record would have drifted
the moment somebody used one door and then the other — and the drift would be
invisible until an event stopped firing for no reason anybody could see. Both
directions are tested: a rule made with `,disableevent` shows up in
`,events list`, and one cleared with `,events enable` is gone from
`,disableevent list` **and** from the gate that actually blocks the event.

⚠️ **A word that is not a channel is refused, not ignored.** Leaving the channel
out means every channel, so reading `#genral` as "absent" would turn a typo into
a server-wide switch-off that looked like it had worked. It says it cannot read
the channel instead.

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

**A module is a cog** — `configuration`, `moderation`, `lastfm`, `help` — so switching one off takes every command in it with it.

**An event is something the bot does that nobody typed**: `autoresponder`,
`autothread`, `counting`, `filter`, `gallery`, `sticky`, `reactions`,
`editrerun`, `welcome`, `goodbye` and `boost`. Eleven of them.

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

Only whole commands can be disabled, not their subcommands: `,automod caps` says
so and points at `,automod`. The gate runs at dispatch, where only top-level
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

## AutoMod

`,automod` is ten filters behind one command, 35 commands in all. It answers
to `,filter` too, which is what it was called for most of its life: the rename
added no commands and removed none, it only changed what they are called.

```
,automod add <word>               filter a word, * wildcards allowed
,automod ignore <word>            let one substring through
,automod whitelist @mods          exempt a role or channel from all of it
,automod caps on --threshold 60   percent uppercase, default 70
,automod emoji on --threshold 3   emoji per message, default 10
,automod spoilers on              spoilers per message, default 5
,automod mentions on -t 5         mentions per message
,automod invites on               server invites
,automod links on                 any link
,automod links ignore github.com  one domain through the link filter
,automod music on                 audio attachments
,automod spam on --threshold 5    messages per five seconds
,automod regex <pattern>          filter by pattern
```

⚠️ **`ignore` and `whitelist` mean opposite things, and they used to be
swapped.** `ignore` takes *text*: a substring the filter lets past. `whitelist`
takes a *role or channel*: someone the filter never looks at. The word one was
called `whitelist` before, and the role one `exempt`. Both old spellings still
resolve to the same handlers, and `,automod whitelist somephrase` says which
command was meant rather than only failing to find a role by that name.

`,automod` on its own reports what is set and how much AutoMod budget is left.
Every filter takes `whitelist <role>` and `<#channel> off`, and each reads back
its own state when run bare. Arguments are **flags** (`helpers/flags.ts`), so
`--threshold`, `--limit` and `-t` are the same thing and order does not matter.

**Five of the ten are enforced by Discord, not by the bot.** Words, invites,
links, patterns and mass mentions are written into the server's own **AutoMod**
rules, so a blocked message is refused as it is typed and never posts at all.
Nothing is deleted after the fact, no Manage Messages is needed, and the filter
keeps working while the bot is down.

The other five — caps, emoji, spoilers, music files and rate — are deleted by
the bot from `onMessage`, because AutoMod cannot express them.

⚠️ **AutoMod only ever sees message text.** It cannot read attachments at all,
which is why `,automod music` has to be bot-side: an `.mp3` is matched on
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
with every other bot, so `,automod` prints what is left rather than letting rule
7 fail with a bare 400. And because `MENTION_SPAM` is a singleton,
`,automod mentions` **edits whatever mention rule already exists** rather than
making its own, and the card names the rule it is touching when that rule is not
one of Trap's.

AutoMod's regex is the Rust engine, which has **no backreferences and no
lookaround**. `,automod regex (a)\1` is rejected by Discord, and the card says
which feature is missing instead of showing a raw 400.

Everything here needs **Manage Channels**, except `reset`, `regex` and
`wordmigrate`, which need Manage Server — they clear or rewrite rules the whole
server sees. `wordmigrate` copies words out of keyword rules made by hand or by
another bot, and leaves those rules alone so nothing is enforced twice by
accident.

## Configuration

Everything is read from `.env`, which pm2 loads with `node --env-file=.env`.
That means the values live in `process.env` inside Node and **never appear in
the process environment**, so checking `/proc/<pid>/environ` to confirm one is
set gives a false negative.

| | |
| --- | --- |
| `DISCORD_TOKEN` | required; a malformed one exits 78 and pm2 gives up |
| `DATABASE_URL`, `PG_POOL_MAX` | Postgres |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` | Redis |
| `PREFIX` | the default prefix, `,`; a server can set its own |
| `GUILD_IDS` | guilds to register `/help` in |
| `COMMAND_SCOPE` | `guild` registers `/help` only in those guilds, which is instant |
| `LASTFM_API_KEY`, `LASTFM_API_SECRET` | without these, linking says so |
| `LASTFM_CALLBACK_BASE` | where Last.fm sends the user back, `https://trap.rocks` |
| `HTTP_BIND`, `HTTP_PORT` | the callback listener |
| `GUILD_MEMBERS_INTENT` | `1` to request the members intent |
| `OPENWEATHER_API_KEY`, `HENRIK_API_KEY` | weather and Valorant; each says when it is missing |
| `STEAM_API_KEY`, `BLOXLINK_API_KEY` | Steam extras, and the Roblox account links |
| `YTDLP_PATH`, `FFMPEG_PATH` | where the two downloaders live |
| `CHROME_PATH`, `CHROME_USER` | the browser for `screenshot`, and the unprivileged account it runs as |
| `PISTON_URL` | the sandbox `run` executes in, on loopback |
| `OLLAMA_URL`, `OLLAMA_MODEL` | the model behind `ask`, on loopback |
| `TRAP_PYTHON`, `TRAP_AUDIO` | the audio virtualenv and the script that uses it |
| `TRAP_TRACE` | `1` logs raw gateway dispatch names |

`.env.example` carries all **30** with their defaults, and the audit checks that
number against the file rather than trusting this sentence.

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

⚠️ **This covers commands, and several features are not commands.** The
autoresponder fires on somebody saying a word, the antinuke on an audit log entry,
and the filter, sticky, gallery and snipe hooks on any message at all. None of
those begin with a prefix, so none of them reach this limit — which is why they
keep their own cooldowns: **four seconds** per trigger per channel for the
autoresponder, **1.2** for a re-run edit. The two layers guard different doors
rather than doing the same job twice.

## Run

1. Put the bot token in `.env` (`DISCORD_TOKEN=...`).
2. `npm install && npm run build`
3. `pm2 start ecosystem.config.cjs && pm2 save`

### Six things npm will not install

Some commands shell out to programs that are not node packages, so `npm install`
does not bring them and a fresh box does not have them. The bot starts either
way — it just does less the more of them are missing, which is the failure mode
to know about, because none of them announce themselves.

| | what it is for | missing it costs |
| --- | --- | --- |
| **yt-dlp** | fetching video and audio | `makemp3`, `transcribe` and `shazam` stop working |
| **ffmpeg** | joining video and audio, and the image filters | `makemp3` and `transcribe` fail; `rotate`, `invert`, `compress` and `hex` stop working |
| **Chrome** | rendering a page for `screenshot` | `screenshot` alone; nothing else notices |
| **Piston** (docker) | running code in a sandbox | `run` says the runner did not answer |
| **/opt/trap-py** | faster-whisper and shazamio | `transcribe` and `shazam` |
| **Ollama** | the model behind `ask` | `ask` says the model is not running |

```
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp
apt-get install -y ffmpeg

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

`YTDLP_PATH` overrides where the binary is looked for.

## Deploy

```
python deploy/deploy.py              upload what changed, build, audit, restart
python deploy/deploy.py --dry-run    say what would go, change nothing
python deploy/deploy.py --status     what pm2 thinks is running
python deploy/deploy.py --logs 40    tail the bot log
python deploy/deploy.py --skip-audit deploy even though the docs disagree
```

**A deploy fails if `docaudit` does.** It runs after the build and before the
restart, so a failure leaves the running bot alone: the new code is on disk and
nothing is serving it, which is the safe half of a half-done deploy. The exit
code is 1, so a script calling this notices too.

⚠️ **The upload happens first, so the server already has the new files.** Only
the restart is withheld. A second attempt will say "nothing to send" because the
payload already matches — use `--force` to make it re-run the build and the
audit.

`--skip-audit` deploys anyway, for when the docs are mid-rewrite and the code
needs to go now. `--no-build` skips the audit too, because it reads `dist/` and
checking a stale build would pass for the wrong reason.

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
custom id, then as the repeated `exempt` and `list` subcommands under `,automod`
colliding on option value, which killed 18 of the browser's views at once.

Two consequences of having no `content`, both found by building on it:

- ⚠️ **A V2 message does not unfurl links.** There is no `content` for Discord to
  read, so a link inside a text component stays text. Anything that depends on
  Discord turning a link into a player has to be sent as a plain message,
  whatever the surrounding feature is set to.
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
within a group, and with 540 subcommands `exempt`, `list`, `add` and `remove`
each belong to a dozen owners. Every id, option value and lookup carries the
full path (`automod caps whitelist view`), resolved by `lookupPath()`. `,help` takes
a path too, so `,help automod links ignore` opens that exact command.

The check that keeps this honest renders **all 861 views** and asserts unique
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
