# Architecture

Trap is a slash-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno) v21,
TypeScript strict, Node 22, run bare under pm2. Postgres holds state; Redis is
the read path and the cache.

## Layout

```
src/
  index.ts              entry point — creates the bot, wires gateway events to
                        core hooks, loads cogs, connects. No feature logic.

  core/                 the framework. Knows nothing about any feature.
    cog.ts              the Cog interface and the loader
    hooks.ts            extension points cogs plug into
    prefix.ts           command registry, argument splitting, name collisions
    slash.ts            slash payloads, autocomplete, and the invocation adapter
    pager.ts            paginated Components V2 cards + their interactions
    guard.ts            UserError and the handler wrapper every command uses
    runner.ts           lets a cog run a command from a component click
    listening.ts        "what is this person playing", asked without a service
    db.ts               Postgres pool and the schema
    redis.ts            Redis client and key/TTL conventions
    discord.ts          raw Discord REST for member lists and permissions
    env.ts              typed configuration access

  helpers/              feature-agnostic utilities. No I/O of their own except
                        http.ts and cache.ts, which exist to be the I/O.
    http.ts             fetch with a timeout, a user agent and typed failures
    cache.ts            read-through Redis caching, negative results included
    cards.ts            Components V2 cards, pages and the shared skin
    markdown.ts         the two escapers, plus number and duration formatting
    imageurl.ts         is this URL safe to show to everyone else
    slashtext.ts        rewrites `,cmd` in copy to its slash form on the way out
    sysinfo.ts          host, process and codebase statistics for /botinfo
    components.ts       Components V2 primitives and builders

  integrations/         third-party services. No Discord knowledge at all, so
                        they are usable from any cog and testable on their own.
    itunes/             search and artwork; needs no key
    artwork.ts          one answer to "what does this look like", covering the
                        gap Last.fm leaves for artists and tracks

  web/
    server.ts           HTTP listener and a route registry cogs add to

  cogs/                 features. One folder each.
    index.ts            the cog list — add a feature by adding a line here
    general/            ping and botinfo (the cog is named "information")
    help/               the command browser
    lastfm/             everything Last.fm
      api/              the HTTP client, split by what a call is for:
                        client.ts (signing, transport, auth), users.ts,
                        charts.ts, discovery.ts, search.ts, tags.ts, writes.ts
                        — together these cover all 55 live API methods
      types.ts          response shapes
      store.ts          account links (Postgres + Redis)
      settings.ts       per-user and per-guild preferences
      shared.ts         targets, periods, history; re-exports the helpers
      guard.ts          TargetError and this cog's error wrapper
      listening.ts      publishes now-playing for other cogs to read
      session.ts        the caller's own credentials, for the commands that write
      hooks.ts          reaction votes
      web.ts            the OAuth callback route
      template.ts       the user-defined card markup
      slash.ts          the layout: parent, group and fields per command
      slashsetup.ts     builds that tree, checks it, enforces the size cap
      commands/         one file per group of commands
```

The dependency rule is one-way: **cogs may import from `core`, `helpers`,
`integrations` and `web`; none of those may import from a cog, and no cog may
import from a sibling cog.** If core needs to reach into a feature, that is a
missing hook.

`core/listening.ts` is what that rule looks like when two cogs genuinely need
to cooperate: whoever can answer "what is this person playing" *registers* a
provider at setup, and whoever needs the answer asks core. Last.fm registers
one. No cog has to import another, and a consumer still works when no provider
is loaded.

## Cogs

A cog is one self-contained feature — its commands, its state, its web routes.

```ts
export const exampleCog: Cog = {
  name: "example",
  description: "What this feature is",
  setup(ctx) {
    registerMyCommands();
    ctx.web.get(/^\/example$/, handler);
  },
};
```

Add it to `src/cogs/index.ts` and it is loaded. Nothing in `src/index.ts`
changes. `setup` receives a deliberately narrow context — prefix, versions,
gateway latency, the web router, message deletion — rather than the bot object,
so a feature cannot quietly reach into the gateway or REST client. Anything a
cog genuinely needs is added to `CogContext` on purpose.

`help` is loaded last because it reads the command registry at setup.

Commands are attributed to their cog automatically: `loadCogs` runs each
`setup` sequentially with the cog's name recorded, so `register()` can stamp it
without every command naming its own cog. `/help` is built from that
attribution, which means the menu always mirrors the real structure — a new cog
appears in help the moment it is listed, with no separate wiring.

## Slash commands

Everything is a slash command; there is no prefix. `/fm` is bare, and the other
115 are real subcommands under two parents:

```
/fm  user:@dylan
/lastfm  charts toptracks  user:@dylan period:30d
/lfmusic listeners wkalbum query:radiohead - kid a
/help  /ping  /botinfo
```

**Two parents, because one cannot hold them.** Discord caps a single command at
**8000 characters** across its whole tree — every name, description, and choice
name and value — and these 115 subcommands come to 13,248. An oversized command
is rejected wholesale as `APPLICATION_COMMAND_TOO_LARGE`, with no indication of
which one, so `slashsetup.ts` computes the size the way Discord does and throws
at boot naming the offender. One parent would only fit by cutting every
description to about 22 characters, which is the text Discord shows in its own
picker; two parents give two budgets and nothing is truncated.

A single command with the name in an autocompleting field was tried first and
is much smaller (318 characters), but it cannot produce a clickable command
mention: Discord resolves a mention's path against the real command structure
and prints anything else as unstyled text. Real subcommands are what make
`</lastfm charts toptracks:id>` render as a chip.

Each area's headline command is **promoted** to sit directly under its parent,
so it reads as `/lfmusic crowns` rather than `/lfmusic crowns crowns`. Discord
allows subcommands and subcommand groups in one option list, but they share a
namespace — a promoted command must not have its group's name, which is why
the groups are named for the set (`counts`, `discovery`, `tagging`,
`listeners`, `social`, `apple`, `scrobbling`) rather than for their headline.
Promotion is an explicit `promote:` field, not inferred from a name match:
inferring it stopped firing silently the moment those groups were renamed.

`cogs/lastfm/slash.ts` is the layout — which parent and group each command
sits in, and which of `user` / `period` / `query` it actually reads. That last
part matters: a period appended to a command that never calls `extractPeriod`
would be parsed as part of the operand, so a field is only filled in for a
command that uses it.

Handlers were not rewritten. Each still takes one free-text `argument`, and the
typed fields are assembled back into that string in the order the existing
parsers expect: mention first (`resolveTarget` only accepts one as the first
word), then the operand, then the period. A field whose value stands for
something else — a custom command word, which means "whoever claimed it" — is
resolved by the cog through the provider's optional `argument()` hook.

`slashsetup.ts` checks the layout against the live registry at boot and refuses
to start if they disagree, because a command missing from the layout is now
completely unreachable.

Replies defer first. Discord discards an interaction that is not acknowledged
within three seconds, and a server-wide who-knows or a 5x5 collage takes longer
than that by design; the first reply edits the placeholder and any further
reply is a followup.

### Budget

The binding limit is characters, not command counts. Measured across both
parents, option descriptions are the largest share, because each shared hint is
repeated across dozens of subcommands — the `user` hint alone was once 40
characters times 69 uses. **When room is needed, shorten the shared hints in
`slash.ts` first:** a command description is cut once, a field hint is cut
everywhere. A third parent adds another full 8000 whenever it is wanted; 94 of
Discord's 100 top-level slots are free.

### Clicking a command

The help card carries a dropdown that **runs** the chosen command, as a new
message, leaving the card open behind it.

A command mention cannot do that. `</lastfm charts toptracks:id>` renders as a
blue chip and is used throughout the help text, but clicking it only *inserts*
the command — Discord offers no way to pre-fill an option from a mention. A
select can, because choosing one is an interaction the bot answers itself.

Running from a click goes through `core/runner.ts`, the same inversion
`core/listening.ts` uses: only `index.ts` can reply to an interaction, and a cog
may not import it, so index registers a runner at startup and the help cog asks
for one. Both paths end in the same function, so a command behaves identically
whether it was typed or clicked.

Command ids come from Discord's reply to the upsert and are kept in
`core/slash.ts`, alongside each command's path. `commandMention` falls back to
code text without them, since a mention with a wrong id renders as raw text.

## Hooks

Cogs extend the runtime through `core/hooks.ts` instead of core importing them:

| Hook | Purpose |
| --- | --- |
| `onUnmatchedCommand` | claim a word no registered command owns (user-defined aliases) |
| `onComponent(prefix, …)` | own a custom-id namespace, e.g. `help\|`, `pg:`, `test:` |
| `onModal(prefix, …)` | the same for modal submissions |
| `onReactionAdd` / `onReactionRemove` | raw reaction events |

Interactions are routed by custom-id prefix, so two cogs cannot silently
collide over the same button.

## Commands

Commands are registered into one registry:

```ts
register({
  name: "example",
  aliases: ["ex"],
  description: "One line",
  handler: guard(async (ctx) => { … }),
});
```

`ctx` carries the argument, ids, and `reply` / `react` / `dm`. Replies are
Components V2 containers built with `buildPages()` / `simpleCard()` and sent via
`paginate()`, which puts the navigation buttons *inside* the card.

Every handler is wrapped in its cog's `guard()`, so an upstream outage or a
bad argument renders a card instead of throwing into a fire-and-forget event.
`guardFor(title)` in `core/guard.ts` builds one per cog. Throw `UserError` (or
a cog's subclass of it, such as `TargetError`) for anything the user can act
on: its message is shown verbatim. Everything else is logged with a stack and
shown as a short message, because an upstream error body is not an explanation.

A name registered twice is reported at startup and the first claim wins.
Silently overwriting is how a command becomes unreachable with nothing to show
for it — worth checking the boot log for `prefix: alias ... already taken`.

## Conventions worth knowing

- **Discordeno v21 predates Components V2.** `helpers/components.ts` defines the
  types locally. This is safe because the REST layer posts the message body
  verbatim, with no camelCase conversion.
- **Two escapers, and the wrong one breaks the card.** `label()` is for text
  *inside* `[label](url)`: it swaps `[`/`]` for fullwidth lookalikes, because
  Discord renders backslash escapes literally inside a link label. `plain()` is
  for text *outside* a link and does backslash-escape, which is required: an
  artist called `*67, im gone` otherwise opens italics and the formatting bleeds
  through every following line.
- **Cards carry no thumbnail.** The accessory renders large enough to dominate
  the card and a missing image shows as a grey placeholder.
- **Bound every fan-out.** Server-wide commands hit the Last.fm API once per
  member: cap the member count, cap concurrency, and say so in the footer.
- **A crown belongs to one server and one artist.** Being the only listener
  wins it — a server can have a dozen linked members and one person who has
  played the artist. Global and album/track listings never write the table,
  and neither does a truncated scan: its "top listener" is the top of a
  sample, and storing that would leave the wrong holder in place for every
  later read.
- **Let `counted()` agree the noun with the number.** Call sites label lists
  inconsistently ("albums" here, "album" there), which produced both
  "1 crowns total" and "5 album total". `buildPages` normalises whatever it
  is given.
- **Every Redis key gets a TTL.** The server runs `maxmemory-policy noeviction`
  and is shared with another application.
- **Last.fm has no artwork for artists or tracks.** `user.gettopartists` and
  `user.gettoptracks` return the same placeholder star for every row, which is
  worse than returning nothing because it looks like an answer.
  `integrations/artwork.ts` knows that and fills the gap from iTunes.
- **A Last.fm chart's response key does not follow from its method name.**
  `chart.getTopArtists` answers under `artists`, `geo.getTopArtists` under
  `topartists`. Locate the container, do not derive the key — see README.
- **`user.getFriends` reports an empty list as an error.** An account that
  follows nobody gets error 6, "no such page", where every other list endpoint
  returns an empty array. It is the only one that does this, so the allowance
  is made there rather than blanket-ignoring the code.
- **Never cache a failed lookup.** `api()` in `core/discord.ts` answers null
  for a 403, a 500 and a network blip alike. Reading that as "no members" and
  caching it took out every server-scoped command for ten minutes while the
  error text blamed a privileged intent that was switched on. A failure now
  throws `MemberFetchError`; only a completed walk is cached.
- **Say which artist you meant.** Searching iTunes for an artist returns
  records by other people who merely feature them, so `lookupArtwork` takes
  the expected credit and skips rows by anyone else.
- **Never bind the web listener to `0.0.0.0`.** This host accepts all inbound
  TCP; loopback plus the docker bridge is what nginx needs.

## Voice

User-facing copy is plain and short. No emoji, with two deliberate
exceptions: the reaction emoji the bot adds to a now-playing post
(`DEFAULT_UPVOTE` / `DEFAULT_DOWNVOTE`), and the crown that replaces the rank
number for whoever holds an artist's crown in a who-knows listing (`CROWN` in
`commands/whoknows.ts`). Both are marks the bot *does* something with, not
decoration. No em dashes; use a full stop, a comma, or a middot as a
separator. A command summary is one line, sentence case, no trailing full stop.
Buttons carry words (Home, Back, Next, Page, Close) rather than symbols.

Avoid: simply, seamlessly, powerful, robust, comprehensive, "worth knowing",
"allows you to". Say what the command does and stop.
