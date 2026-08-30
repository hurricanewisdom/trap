# Architecture

Trap is a prefix-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno) v21,
TypeScript strict, Node 22, run bare under pm2. Postgres holds state; Redis is
the read path and the cache. 106 source files, no comments — the names and the
shape carry it.

## Layout

```
src/
  index.ts              entry point — creates the bot, wires gateway events to
                        core hooks, loads cogs, connects. No feature logic.

  core/                 the framework. Knows nothing about any feature.
    cog.ts              the Cog interface and the loader
    hooks.ts            extension points cogs plug into
    prefix.ts           command registry: names, aliases, groups, categories
    prefixes.ts         which prefixes a guild answers to
    permissions.ts      guild and Manage Server gates, and the denial card
    accent.ts           the ambient per-viewer card colour
    slash.ts            slash payloads, autocomplete, and command mentions
    pager.ts            paginated Components V2 cards + their interactions
    expiry.ts           disables a card's controls after 60s of no clicks
    guard.ts            UserError and the handler wrapper every command uses
    runner.ts           lets a cog run a command from a component click
    listening.ts        "what is this person playing", asked without a service
    db.ts               Postgres pool and the schema
    redis.ts            Redis client and key/TTL conventions
    discord.ts          raw Discord REST for member lists and permissions
    automod.ts          Discord AutoMod rules, their caps, and error translation
    env.ts              typed configuration access

  helpers/              feature-agnostic utilities. No I/O of their own except
                        http.ts and cache.ts, which exist to be the I/O.
    http.ts             fetch with a timeout, a user agent and typed failures
    cache.ts            read-through Redis caching, negative results included
    cards.ts            Components V2 cards, pages and the shared skin
    markdown.ts         the two escapers, plus number and duration formatting
    imageurl.ts         is this URL safe to show to everyone else
    sysinfo.ts          host, process and codebase statistics for ,botinfo
    components.ts       Components V2 primitives and builders
    flags.ts            --flag parsing, shared by every command that takes one

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
    config/             server settings
      prefix.ts         which prefixes the server answers to
      boosterrole/      personal colour roles for boosters: store.ts,
                        shared.ts (gates, colour parsing), member.ts,
                        admin.ts, share.ts
      greetings/        one implementation behind ,welcome, ,goodbye and
                        ,boosts: messages.ts is the store and the command
                        factory, variables.ts the token table. Three registrars,
                        three categories, three hooks — one per event
      filter/           ten chat filters: words.ts, thresholds.ts (caps, emoji,
                        spoilers), mentions.ts, automodfilters.ts (invites,
                        links), content.ts (music files, rate), patterns.ts,
                        store.ts for the bot-side settings, shared.ts for the
                        role and channel parsing they all do
      alias/            per-server shortcuts, resolved through
                        onUnmatchedCommand so they can never shadow a command
      sticky/           a message kept at the bottom of a channel, reposted
                        once the chat settles
      gallery/          channels that only take images; deletes anything
                        posted without one
    help/               the command browser
      model.ts          one indexed view of the registry + catalog
      search.ts         ranking, for /help autocomplete and ,help <query>
      render.ts         every view, and the component-id codec
      commands.ts       routing, interactions and modals
      catalog.ts        hand-written command documentation, data only
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
      hooks.ts          reaction votes and custom-command words
      web.ts            the OAuth callback route
      template.ts       the user-defined card markup
      commands/         one file per group of commands
```

The dependency rule is one-way: **cogs may import from `core`, `helpers`,
`integrations` and `web`; none of those may import from a cog, and no cog may
import from a sibling cog.** If core needs to reach into a feature, that is a
missing hook.

Four things follow that shape rather than importing across it — a provider is
registered at setup and core asks for it: `core/listening.ts` (who is playing
what), `core/runner.ts` (run a command from a click), `core/expiry.ts` (edit a
message later) and `core/accent.ts` (this viewer's colour). Each still works
when nothing registers.

## Cogs

A cog is one self-contained feature — its commands, its state, its web routes.

```ts
export const exampleCog: Cog = {
  name: "example",
  label: "Example",
  description: "What this feature is",
  setup(ctx) {
    inCategory("example", registerMyCommands);
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

Commands are attributed automatically. `loadCogs` runs each `setup` with the
cog's name recorded, so `register()` stamps it. `groupUnder(owner, …)` and
`inCategory(slug, …)` do the same for the other two axes, which is what makes
help mirror the real structure with no separate wiring.

## The registry

One registry, three axes, all ambient:

```ts
register({ name: "example", aliases: ["ex"], description: "One line", handler });

groupUnder("prefix", () => { register({ name: "add", … }); });
inCategory("charts", registerCharts);
```

- **cog** — which folder it came from.
- **group** — `,prefix add` rather than `,add`. A grouped command is not
  callable at top level; typing `,add` answers "That is `,prefix add`."
- **category** — the themed slice help groups a large cog by. One
  `inCategory(slug, registrar)` line categorises every command in that module,
  including ones added later. **One feature, one slug**: three greetings behind
  one `greeting` slug rendered as a single group, so `welcome`, `goodbye` and
  `boost` are separate slugs with separate registrars. A slug needs a matching
  row in `help/catalog.ts`; without one `sectionsOf()` drops it and every
  command in it disappears from the groups view.

**Names are namespaced by group.** `lookup(name)` prefers a top-level command
and falls back to scanning groups; `lookupIn(group, name)` stays inside one, and
`lookupPath("filter caps exempt")` walks a whole path down to the command. That
is why `,about` reaches `botinfo` while `,lf about` reaches `bio`. A flat
registry silently dropped the second one and warned about it on every boot.

Which means **a bare name is not an identity**, and anything that stores or
compares one is a bug waiting to happen. With 201 subcommands, `exempt`, `list`,
`add`, `remove`, `view` and `filter` each belong to several owners. Use the path
(`pathOf(entry)` in help, `lookupPath()` in core) anywhere a command has to be
named to something outside the function that already has it.

A name registered twice inside the same namespace is reported at startup and
the first claim wins. Silently overwriting is how a command becomes unreachable
with nothing to show for it — worth checking the boot log for
`prefix: alias ... already taken`.

## Invocation

Commands are **prefix commands**, dispatched from `messageCreate`. `/help` is
the only slash command, so the browser is reachable from Discord's picker while
everything else stays short to type — `,toptracks @dylan 30d` rather than
`/lastfm charts toptracks user:@dylan period:30d`.

That needs the privileged **message content intent**, which is enabled for this
application. Without it the gateway closes with 4014 and the bot never starts.

A **guild chooses its own prefixes** (`core/prefixes.ts`, `,prefix`). The
dispatcher matches against that list longest-first, so `,,` beats `,`. It reads
an in-process Map, not the database — this runs on every message in every
channel, so it must not do I/O. A guild's first message after a restart loads
once; writes call `forget(guildId)`. If the query throws, the last known value
is used, so a database blip cannot make the bot go silent.

**Mentioning the bot is always a prefix.** Without that, setting the prefix to
something unusable would lock a server out with no way back.

A word the registry does not own falls through to `onUnmatchedCommand`, which
is how a member's own custom command word resolves.

### Clicking a command

The help card carries a dropdown that **runs** the chosen command, as a new
message, leaving the card open behind it. It goes through `core/runner.ts`, the
same inversion `core/listening.ts` uses: only `index.ts` can reply to an
interaction and a cog may not import it, so index registers a runner at startup
and the help cog asks for one.

## Hooks

Cogs extend the runtime through `core/hooks.ts` instead of core importing them:

| Hook | Purpose |
| --- | --- |
| `onUnmatchedCommand` | claim a word no registered command owns (user-defined aliases) |
| `onComponent(prefix, …)` | own a custom-id namespace, e.g. `help\|`, `pg:` |
| `onModal(prefix, …)` | the same for modal submissions |
| `onReactionAdd` / `onReactionRemove` | raw reaction events |
| `onBoost` | somebody boosted the server |
| `onMessage` | any message in a guild, command or not |
| `onMemberJoin` / `onMemberLeave` | somebody joined or left |

Interactions are routed by custom-id prefix, so two cogs cannot silently
collide over the same button.

## Commands

`ctx` carries the argument, ids, and `reply` / `react` / `dm`. Replies are
Components V2 containers built with `buildPages()` / `simpleCard()` and sent via
`paginate()`, which puts the navigation buttons *inside* the card.

Every handler is wrapped in its cog's `guard()`, so an upstream outage or a
bad argument renders a card instead of throwing into a fire-and-forget event.
`guardFor(title)` in `core/guard.ts` builds one per cog. Throw `UserError` (or
a cog's subclass of it, such as `TargetError`) for anything the user can act
on: its message is shown verbatim, under its own title if it carries one.
Everything else is logged with a stack and shown as a short message, because an
upstream error body is not an explanation.

For anything gated, use `core/permissions.ts` rather than hand-rolling a
denial: `requireGuild(ctx, action)`, `requireManageChannels(ctx, action)` and
`requireManageGuild(ctx, action)` each return the guild id, or reply with the
standard card and return `null`. Gate at the level the change actually reaches:
one channel is Manage Channels, anything that clears or rewrites what the whole
server sees is Manage Server.

Named arguments are **flags**, parsed by `helpers/flags.ts` and never by
position. `parseFlags()` returns the leftover words plus a map, so
`,filter caps on --threshold 60` and `,filter caps --threshold 60 on` are the
same command, and `flagNumber(flags, "threshold", "limit", "t")` accepts all
three spellings of one option.

## Colour

Cards are colourless by default. `,lfcolor` sets a per-user colour that follows
that person across every Last.fm card they pull up.

It travels as an **ambient value**, not an argument: `core/accent.ts` holds an
`AsyncLocalStorage`, `index.ts` resolves the invoker's colour once per message
and wraps the dispatch, and every container reads it through `accented()`.
Threading a colour parameter through a hundred call sites was the alternative.

Two traps live here. `USER_ACCENT` is **`null`, not a colour** — it means
"inherit whatever the invoker set", and roughly 27 files pass it. And a
container built as a bare `{ type: 17, … }` literal instead of through
`container()` / `accented()` silently renders colourless while everything
around it tints.

## Conventions worth knowing

- **Discordeno v21 predates Components V2.** `helpers/components.ts` defines the
  types locally. This is safe because the REST layer posts the message body
  verbatim, with no camelCase conversion.
- **Every custom id in one message must be unique, and so must every option
  value within a select.** Discord rejects the whole message, the edit never
  lands, and the user sees "Trap didn't respond in time". A local size audit
  will not catch either. Help shipped three times with a duplicate: every select
  sharing an id; then **Next** (`page + 1`) and **»** (`count - 1`) computing
  the same id on a two-page list; then selects keyed by bare command name, where
  the repeated `exempt` and `list` subcommands under `,filter` collided and
  killed 18 of 302 views. Nav buttons carry distinct *actions* and compute the page at handle
  time; selects carry paths.
- **Verify component payloads against the real API.** Structure checks passed
  on payloads Discord rejected outright. Post one to a channel and read the
  status, and space the posts out — a burst comes back 429, which reads exactly
  like a rejected payload.
- **Prefer AutoMod to deleting messages.** A rule Discord enforces refuses the
  message as it is typed, needs no Manage Messages, and keeps working while the
  bot is down. `core/automod.ts` owns the rules and translates the error codes.
  Its limits are server-wide and shared with every other bot, so treat them as a
  budget: **6 keyword rules per guild** (Trap uses up to 4 and prints what is
  left), 10 regex per rule, 20 exempt roles, 50 exempt channels. The regex is
  Rust, so no backreferences and no lookaround.
- **AutoMod cannot see attachments, only text.** Anything that depends on what
  was uploaded rather than what was typed has to be bot-side, which is the whole
  reason `,filter musicfiles` runs on `onMessage`.
- **`MENTION_SPAM` is a singleton per guild, and undeletable in a Community
  server.** `,filter massmention` edits whatever rule already exists and names
  it when it is not Trap's. Creating one blindly overwrites the server's own
  mention protection, which has happened. Read a rule before writing it.
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
- **A catalog entry documents one command, not every command with that name.**
  `help/model.ts` gives a doc to the command whose ambient category matches it,
  falling back to the top-level one. Keyed by name alone,
  `,boosterrole filter` wore `,filter`'s documentation and filed itself under
  Filters.
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
- **Never request a privileged intent that is not enabled in the portal.** The
  gateway closes with **4014** and the bot never starts, so it is a failure that
  takes everything down rather than degrading one feature. `GUILD_MEMBERS_INTENT`
  gates the members intent for that reason. Two related traps: the application
  flags report an enabled intent on an *unverified* bot as `*_LIMITED`, which
  means enabled; and `--env-file` puts values in `process.env` without touching
  `/proc/<pid>/environ`, so the process environment is not where to check.
- **An update event carries no "before" state.** `guildMemberUpdate` says what a
  member is now, not what changed, so a boost is a `premium_since` that was null
  last time we looked. `booster_state` holds that baseline and a member seen for
  the first time is recorded silently, or a redeploy announces every existing
  booster at once.
- **Anything on the message path must not do I/O.** `messageCreate` runs for
  every message in every channel: prefix resolution, the sticky check and the
  alias fallback all read an in-process cache invalidated on write, never the
  database.

## Voice

User-facing copy is plain and short. No emoji, with two deliberate
exceptions: the reaction emoji the bot adds to a now-playing post
(`DEFAULT_UPVOTE` / `DEFAULT_DOWNVOTE`), and the crown that replaces the rank
number for whoever holds an artist's crown in a who-knows listing (`CROWN` in
`commands/whoknows.ts`). Both are marks the bot *does* something with, not
decoration. No em dashes; use a full stop, a comma, or a middot as a
separator. A command summary is one line, sentence case, no trailing full stop.
Buttons carry words (Home, Back, Next, Page, Close) rather than symbols.

A card does not describe itself. A cog page lists its commands; it does not
open with a sentence about what the cog is for. That sentence lives in the
dropdown that navigates to it, once.

Avoid: simply, seamlessly, powerful, robust, comprehensive, "worth knowing",
"allows you to". Say what the command does and stop.
