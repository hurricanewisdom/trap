# Trap

Slash-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno)
(TypeScript strict, Node 22), run bare with pm2. 119 commands, covering every
live method of the Last.fm API.

**[ARCHITECTURE.md](ARCHITECTURE.md)** describes the layout, the cog system and
the conventions — read that first if you are adding a feature.

## Commands

Slash only; there is no prefix. Six top-level commands:

| Command | What it is |
| --- | --- |
| `/fm` | now playing — the one everybody runs |
| `/lastfm <group> <name>` | your account, charts and listening stats |
| `/lfmusic <group> <name>` | music, tags, discovery and who else listens |
| `/help [query]` | the command browser |
| `/ping` | gateway latency |
| `/botinfo` | host, process and codebase statistics |

The 115 Last.fm commands are real subcommands under the two parents. Each
area's headline is promoted to sit directly under its parent, so the common
ones stay short:

```
/fm                              /lfmusic crowns
/lastfm plays  query:radiohead   /lfmusic whoknows query:radiohead
/lastfm scrobble                 /lfmusic discover
/lastfm charts toptracks  user:@dylan period:30d
/lfmusic listeners wkalbum  query:radiohead - kid a
/lfmusic tagging tagartist  query:Radiohead | shoegaze
```

Getting started: `/lastfm account lastfm query:link` DMs an authorisation link,
after which `/fm` works. `/help` browses everything, and its Find button
searches all 119 by name.

**Why two parents rather than one**, and why the groups are named as they are,
is in [ARCHITECTURE.md](ARCHITECTURE.md#slash-commands) — it comes down to
Discord's 8000-character cap per command.

### Custom commands

A member can claim one word in a server as a shorthand for their own now
playing. With no prefix to type it against, the word lives on the command it
aliases: **`/fm custom:<word>`**, autocompleted from what has been claimed
there. `/lastfm customize customcommand` manages them. A private word is
invisible in anyone else's autocomplete and refuses to resolve for them.

## Run

1. Put the bot token in `.env` (`DISCORD_TOKEN=...`).
2. `npm install && npm run build`
3. `pm2 start ecosystem.config.cjs && pm2 save`

## Operate

- `pm2 logs trap` — live logs
- `pm2 status` / `pm2 monit` — process list / CPU+RAM dashboard
- `pm2 restart trap` — restart (after `npm run build` for code changes)

A missing/malformed token exits with code 78 and pm2 stops the app instead of
restart-looping (`stop_exit_codes`).

## Components V2

discordeno v21 predates Components V2, so `src/components.ts` defines the types
and builders itself. This is safe because the REST layer posts the interaction
body verbatim — no camelCase conversion — so Discord-shaped (snake_case)
component JSON goes over the wire untouched.

A V2 message must set flag `1 << 15` and may not also send `content` or
`embeds`. A message may hold at most five action rows, which is why the help
card's controls are two selects and one button row rather than more.

## Last.fm

`/lastfm account lastfm query:link` mints a random single-use state, stores it in Redis for ten minutes,
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

`/fm` reads `user.getRecentTracks` (extended, for the loved flag) and adds the
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

Voting works off the reactions `/fm` already adds. The bot's own seed reactions
are ignored — Discord dispatches those back as ordinary reaction events — and
nobody can vote on their own post. Votes cascade away with the post.

### Customization

Now-playing has four styles. Three are embeds because inline fields are the
only way to get columns; `container` matches the Components V2 card the rest of
the bot uses. Colour, style and voting emoji are per-user, with the server
providing a fallback pair for reactions.

Everything read on the `/fm` path — style, colour, reactions, artwork override
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

## Help

`/help` lists the loaded **cogs**, mirroring the source layout. Opening one
shows its sections (or its commands outright, for a small cog), and a section
lists its commands — one Components V2 card with a cog dropdown, a **Run a
command** dropdown, and Home / paging / Find / Close buttons inside the
container.

Every entry is a real command mention, so it renders as a clickable chip and
inserts the full path. Running one is the dropdown's job: a mention can only
insert, never execute, and cannot pre-fill a field.

`/help <query>` jumps straight to a command and resolves aliases, so
`/help ta` finds `toptracks`. Cogs and sections work too, and a leading group
name is dropped when the whole query does not match, so `/help charts
toptracks` lands on the command. The full query is tried first, which keeps
multi-word section labels like `/help Now playing` intact. Where a cog shares a
name with a command the **cog wins**, and the cog view points at the same-named
command so nothing becomes unreachable.

Because a dropdown holds 25 options and a page shows 8, neither could ever
reach all 119 commands. **Find** opens a modal that takes anything `/help`
takes, which is the only control that can.

The menu is **stateless**: the whole view — which page of which category, and
who owns it — is encoded in the component custom ids, so it keeps working after
a restart and stores nothing. Only the person who ran it can drive the controls.

`src/cogs/help/catalog.ts` is data only, keyed by the primary command name. The
menu is generated from the *live registry* — including which cog registered
each command — and merely decorated with the catalog, so a command that is
registered but undocumented still appears rather than silently vanishing.

## Statistics

`/botinfo` is a monospace panel: CPU, host memory and disk as proportional
bars, then process figures, then the codebase.

CPU comes from two samples of `os.cpus()` about 120ms apart rather than
`os.loadavg()`, which means something different — a queue length averaged over
a minute, reading zero on a briefly pinned box and staying high after work
stops. Disk uses `bavail` rather than `bfree`, since the root-reserved blocks
are not usable space. Source file and line counts walk `src` once and are
cached; they cannot change without a redeploy.
