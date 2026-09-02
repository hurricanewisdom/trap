# Architecture

Trap is a prefix-command Discord bot on [Discordeno](https://github.com/discordeno/discordeno) v21,
TypeScript strict, Node 22, run bare under pm2. Postgres holds state; Redis is
the read path and the cache. 195 source files, no comments — the names and the
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
    style.ts            the emoji, colour, pinging and punctuation one server
                        chose, carried through a command in a scope
    slash.ts            slash payloads, autocomplete, and command mentions
    restrict.ts         a command handed to one role, asked at dispatch
    throttle.ts         one rate limit across every command, in memory; the
                        numbers come from the ratelimit cog through a provider
    pager.ts            paginated Components V2 cards + their interactions,
                        for commands that reply and for callers that post
    expiry.ts           disables a card's controls after 60s of no clicks
    guard.ts            UserError and the handler wrapper every command uses
    runner.ts           lets a cog run a command from a component click
    listening.ts        "what is this person playing", asked without a service
    db.ts               Postgres pool and the schema
    redis.ts            Redis client and key/TTL conventions
    discord.ts          raw Discord REST for member lists, permissions, roles,
                        uploads, reactions, threads and who wears the server tag
    automod.ts          Discord AutoMod rules, their caps, and error translation
    availability.ts     what is switched off where, and what can never be
    edits.ts            whether an edited message should run its command again
    ignores.ts          members and channels the bot reads nothing from
    fakeperms.ts        which permissions a role is treated as holding, and the
                        set that can be handed out at all
    protection.ts       one log for everything that defends the server, with
                        how long each response took; buffered, because the
                        filters fire on ordinary messages
    env.ts              typed configuration access

  helpers/              feature-agnostic utilities. No I/O of their own except
                        http.ts and cache.ts, which exist to be the I/O.
    http.ts             fetch with a timeout, a user agent and typed failures
    cache.ts            read-through Redis caching, negative results included
    cards.ts            Components V2 cards, pages and the shared skin
    markdown.ts         the two escapers, plus number and duration formatting
    duration.ts         reading 10m or 2h30m, telling one from a reason, and
                        saying it back in words
    imageurl.ts         is this URL safe to show to everyone else
    net.ts              does this hostname resolve somewhere private -- the one
                        guard every command that fetches a given address shares
    sysinfo.ts          host, process and codebase statistics for ,botinfo
    components.ts       Components V2 primitives and builders
    flags.ts            --flag parsing, and CommandFlag: the declaration a
                        command registers so the help card and the parser read
                        the same names and cannot drift apart

  integrations/         third-party services. No Discord knowledge at all, so
                        they are usable from any cog and testable on their own.
    itunes/             search and artwork; needs no key
    artwork.ts          one answer to "what does this look like", covering the
                        gap Last.fm leaves for artists and tracks

  web/
    server.ts           HTTP listener and a route registry cogs add to

  cogs/                 features. One folder each.
    index.ts            the cog list — add a feature by adding a line here
    config/             server settings
      prefix.ts         which prefixes the server answers to
      antiraid/         the door rather than the furniture: watch.ts holds both
                        detection paths -- joins for massjoin, newaccount, avatar
                        and automation, messages for spam, mentionspam and
                        raidspam -- act.ts pauses invites by rewriting the guild
                        features array and carries out the punishment, store.ts
                        the per-module settings and the whitelist
      antinuke/         the server's last line of defence, owner only.
                        watch.ts listens to GUILD_AUDIT_LOG_ENTRY_CREATE, which
                        names the actor at the moment of the act; store.ts holds
                        the per-module settings, the trust list and the
                        whitelist, cached and failing to the last known answer;
                        spam.ts is the one message-path watch, for webhook
                        mass-mentions, which deletes the webhook rather than
                        punishing a member because there is no member, and
                        skips channels on the per-channel exemption list. Every
                        response is timed into core/protection.ts, which
                        ,antinuke log reads back
      boosterrole/      personal colour roles for boosters: store.ts,
                        shared.ts (gates, colour parsing), member.ts,
                        admin.ts, share.ts, include.ts (roles that may
                        make one without boosting)
      greetings/        one implementation behind ,welcome, ,goodbye and
                        ,boosts: messages.ts is the store and the command
                        factory, variables.ts the token table. Three registrars,
                        three categories, three hooks — one per event
      filter/           `,automod`: ten chat filters, words.ts, thresholds.ts
                        (caps, emoji, spoilers), mentions.ts, automodfilters.ts
                        (invites, links), content.ts (music files, rate),
                        patterns.ts, store.ts for the bot-side settings, and
                        shared.ts for the role and channel parsing they all do
      alias/            per-server shortcuts, resolved through
                        onUnmatchedCommand so they can never shadow a command
      sticky/           a message kept at the bottom of a channel, reposted
                        once the chat settles
      gallery/          channels that only take images; deletes anything
                        posted without one
      confessions/      anonymous confessions behind a button: store.ts,
                        flow.ts (the panel, the modal, the checks, review and
                        reply), index.ts. Four levels deep
      counting/         the counting game: store.ts, game.ts (the message
                        hook, and an arithmetic parser rather than an
                        evaluator), index.ts
      counter/          channels whose name is a live figure: store.ts,
                        sources.ts (one reader per platform, and which of them
                        are possible at all), template.ts (the token engine and
                        its {if:} scanner), index.ts
      button/           response buttons on my own messages: store.ts,
                        render.ts (rebuilds the components, keeping every row
                        it did not write), index.ts. render.ts is shared: it
                        takes the custom-id prefix, so each feature owns its
                        rows and preserves the other's
      buttonrole/       roles members give themselves by pressing a button:
                        store.ts, index.ts. Renders through button/render.ts
      dropdownrole/     roles members pick from a menu: store.ts, index.ts.
                        Renders through button/render.ts as well -- a select is
                        one prebuilt row rather than a row of faces
      autorole/         roles handed out on join: store.ts (cached, capped at
                        ten), index.ts (the commands and the join hook)
      autothread/       a thread on every message in a channel: store.ts,
                        watch.ts (the message hook), index.ts. Borrows the
                        greetings variable table rather than growing its own
      autoresponder/    automatic replies: store.ts, responder.ts (the matcher
                        on the message path), roles.ts, exclusive.ts, gate.ts
                        (the role hierarchy check), shared.ts
      availability/     turning commands, modules and events off per channel
      events/           a second door onto the event half of availability/,
                        calling its store rather than keeping one of its own
      ignore/           members and channels skipped before anything runs
      appearance/       the server icon, banner and splash background
      webhook/          posting as a named identity; ids in the database, the
                        token fetched when needed and never kept
      fakeperms/        letting a role use the bot without the real permission
      badge/            rewarding members who wear the server tag; sync.ts sweeps
                        the member list, store.ts remembers who has been thanked
      ratelimit/        how many commands a person or a server may run, and the
                        provider that hands those numbers to core/throttle.ts
      customize/        the bot's own avatar, banner and bio in one server;
                        images.ts fetches the link and refuses private addresses,
                        which screenshot leans on hardest of all
      suggest/          member suggestions and the statuses staff move them
                        through; store.ts holds config, suggestions and the
                        ignore list, post.ts renders a card and edits it in place
      pins/             the pin archive: where a channel's pins are flushed to,
                        and the channelPinsUpdate hook that does it at 45
      pagination/       several embeds behind one message, turned with buttons:
                        embedcode.ts parses the page code, store.ts holds pages
                        by stable id
    moderation/         punishments, the case log, roles, purging and channels
      cases.ts          the per-server case numbers everything else looks up
      config.ts         jail, mute and lock roles, and the ban purge default
      schedule.ts       anything with a duration: temporary bans, mutes, roles
                        and reminders. Rows with a due time, not timers
      shared.ts         parsing a member, role or channel, and whether this
                        moderator may act on that member at all
      punish.ts         ban, softban, tempban, unban, hardban, warn, timeout
      history.ts        the case log commands: history, proof, notes, reason
      jail.ts           jail and the three mutes, and the roles they need
      roles.ts          the twenty role commands, including the mass ones
      purge.ts          twenty-one ways to delete messages, one test each
      channels.ts       lockdown, hide, slowmode, topic, nuke, invites
      threads.ts        renaming, locking and membership of one thread
      people.ts         reminders, nicknames, sticky roles, raids, voice moves
      extras.ts         restricted commands, scheduled nukes, unban-all
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

Seven things follow that shape rather than importing across it — a provider is
registered at setup and core asks for it: `core/listening.ts` (who is playing
what), `core/runner.ts` (run a command from a click), `core/expiry.ts` (edit a
message later), `core/accent.ts` (this viewer's colour), `core/availability.ts`
(what is switched off where) and `core/ignores.ts` (who is not read at all).
Each still works when nothing registers, and each fails open: no provider means
no restriction.

That is what makes a cog removable. When the general, utility, roleplay and
misc cogs were deleted, nothing in the four that remain had to change, because
none of them had ever imported anything from the four that went.

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
`lookupPath("automod caps whitelist")` walks a whole path down to the command. That
is why `,about` reaches `botinfo` while `,lf about` reaches `bio`. A flat
registry silently dropped the second one and warned about it on every boot.

Which means **a bare name is not an identity**, and anything that stores or
compares one is a bug waiting to happen. With 540 subcommands, `exempt`, `list`,
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
| `onComponent(prefix, …)` | own a custom-id namespace, e.g. `help\|`, `pg:`, `pgn:` |
| `onModal(prefix, …)` | the same for modal submissions |
| `onReactionAdd` / `onReactionRemove` | raw reaction events |
| `onBoost` | somebody boosted the server |
| `onMessage` | any message in a guild, command or not |
| `onMemberJoin` / `onMemberLeave` | somebody joined or left |
| `onMemberUpdate` | a member changed: roles, nickname, boost, or the server tag they wear |
| `onMessageDelete` / `onMessageEdit` | a message went away or changed |
| `onChannelPins` | a channel's pins changed |

Interactions are routed by custom-id prefix, so two cogs cannot silently
collide over the same button.

`onMessage`, `onReactionAdd` and `onReactionRemove` take an optional **event
name** as a second argument. A named handler is skipped when that event is
switched off in the channel the event came from, which is how
`,disableevent` reaches ten of its eleven events without any feature knowing it
exists. The tenth, `editrerun`, rides no hook and is checked where
`messageUpdate` decides whether to dispatch.

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

**Every command gate goes through `holds()` in `core/permissions.ts`**, not
`hasPermission()` directly. `holds()` is the real Discord check OR whatever a
fake permission grants that member's roles, which is how `,fakepermissions`
reaches every gate at once without any of them knowing it exists.

⚠️ **`requireOwner` is the deliberate exception.** It compares the guild's
`owner_id` and never consults `holds()`, so a granted role cannot reach the
command that hands out grants. A privilege that can widen itself is not a
privilege.

For anything gated, use `core/permissions.ts` rather than hand-rolling a denial.
Each of these returns the guild id, or replies with the standard card and
returns `null`, and they run in rough order of how far the change reaches:

| | |
| --- | --- |
| `requireGuild` | not a permission, just "not in a DM" |
| `requireManageMessages` | one message: pinning, clearing snipes, warning somebody |
| `requireModerateMembers` | silencing somebody for a while: timeouts and mutes |
| `requireManageNicknames` | what somebody is called here |
| `requireMoveMembers` | dragging people between voice channels |
| `requireManageThreads` | one thread: renaming, locking, membership |
| `requireManageChannels` | one channel: filters, availability, lockdown |
| `requireManageRoles` | who holds what: role commands, temporary roles |
| `requireBanMembers` | removing somebody from the server |
| `requireManageGuild` | what the whole server sees: prefixes, greetings, aliases |
| `requireManageWebhooks` | posting as somebody else |
| `requireAdministrator` | clearing everything at once |
| `requireOwner` | handing out permissions |

Gate at the level the change actually reaches. A command that edits one channel
should not ask for Manage Server, and one that wipes every setting in the guild
should not settle for Manage Channels.

⚠️ **A read-only view is often not gated at all** — `,prefix list`,
`,webhook list` and `,firstmessage` answer anybody. Read the `require*` call
before assuming a command is protected; guessing wrong is how a test ends up
measuring nothing.

Named arguments are **flags**, parsed by `helpers/flags.ts` and never by
position. `parseFlags()` returns the leftover words plus a map, so
`,automod caps on --threshold 60` and `,automod caps --threshold 60 on` are the
same command.

A command **declares** the flags it takes, and the declaration is used twice:

```ts
const THRESHOLD: CommandFlag = {
  name: "threshold",
  description: "How many it takes to trip the module.",
  aliases: ["t", "count"],
  takes: "<1-50>",
};

register({ name: "channel", description: "...", handler, flags: [THRESHOLD, DURATION] });
```

The help card renders it, and the command reads its value through
`numberFor(parsed, THRESHOLD)` rather than through a separate list of strings.
That is the point: a flag described in prose and parsed by a list somewhere else
drifts the moment either is renamed, and **the failure is silent** — the help
goes on advertising a flag that no longer does anything. Declaring it on the
command also means a group registered in a loop documents itself without a
hand-written catalog entry each — which is how twenty commands across the
antinuke, the antiraid and the filters carry flags with three declarations
between them.

`unknownFlags()` compares what was typed against what was declared, so
`--treshold 5` is reported rather than dropped, which is what stops somebody
walking away sure they had set a threshold they had not.

⚠️ **A shared flag whose meaning differs is not shared.** The antiraid's
`newaccount` counts days where its siblings count events, and reusing their
`--threshold` gave it a card promising `<1-200>` for a bound that was really
1-365 — the command would refuse what its own help advertised. It declares its
own, worded for days. Same name, different flag; the declaration is per command
for exactly this reason.

A command can have subcommands **and** flags — `antinuke webhookspam` has both —
so the group card renders both. Rendering only the subcommands, which is what it
did at first, hides half of what the command accepts.

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
  the repeated `exempt` and `list` subcommands under `,automod` collided and
  killed 18 views at once. Nav buttons carry distinct *actions* and compute the
  page at handle time; selects carry paths.
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
  reason `,automod music` runs on `onMessage`.
- **`MENTION_SPAM` is a singleton per guild, and undeletable in a Community
  server.** `,automod mentions` edits whatever rule already exists and names
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
  `,boosterrole filter` wore `,automod`'s documentation and filed itself under
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
- **A delete event carries an id and nothing else.** Discord sends no author and
  no content on `messageDelete`, and `messageUpdate` sends the new message
  without the old one, so anything that wants either has to have cached it on
  the way past. The snipe store is that cache: in process, bounded three ways,
  and gone on restart.
- **A message the bot deleted must never come back through a read command.**
  `deleteMessage()` drops the snipe entry before issuing the delete, so the word
  filter cannot be defeated with `,snipe`. Doing it in the one shared helper
  covers every caller, including ones added later.
- **An interlock between two hooks must not depend on their order.** That fix
  above still leaked, because the config cog loads before the utility cog: the
  filter forgot the message before it had been remembered, and `remember()` put
  it straight back. A forgotten id now goes into a suppression set that
  `remember()` checks. Two handlers on the same event have no defined order
  worth relying on; make the invariant hold either way.
- **Reply text written by a moderator is not fully trusted.** Autoresponder
  replies are authored behind Manage Channels, which is a lower bar than Manage
  Server, so the send pins `allowed_mentions` to users and roles and `@everyone`
  can never be reached however the reply is written.
- **Check a role against the hierarchy when it is configured, not when it
  fires.** A grant that silently fails on the message path is invisible; the
  same check at setup time is a card that says which role is too high.
- **Ids handed to a user must never renumber.** Pagination page ids survive a
  deletion, so an id copied out of a list stays valid. Compacting them silently
  retargets every id somebody already wrote down.
- **Strip the whole token, not the part the regex matched.** A message link
  matched as `channels/…` inside a full URL left `https://discord.com/` in the
  remaining argument, which the next positional read took for a page id.
- **Gate a cross-cutting rule once, where the dispatch happens.** Disabled
  events are enforced in `core/hooks.ts`: a handler registers with a name and
  the emitter skips it when that event is off. Asking every feature to check
  itself would mean the next one forgets.
- **A safety list has to hold on both sides.** The commands that re-enable
  things are refused at write time *and* ignored by the gate at read time, so
  neither a mistake nor a stale row can lock a server out of its own settings.
- **An update event is not the same as an edit.** `messageUpdate` also fires
  when a link preview resolves, a message is pinned, or an upload finishes, all
  carrying unchanged content. `core/edits.ts` keeps the last text seen and acts
  only on a real change, and does nothing at all when it has no record — a
  missed rerun beats a command nobody typed.
- **One dispatch path, called from two events.** `runPrefixCommand` in
  `index.ts` serves both `messageCreate` and `messageUpdate`, so prefixes, the
  availability gate, group routing and accent cannot drift between them.
- **A silencing switch needs a way back in.** Ignoring a channel skips every
  message in it, so the `ignore` commands are the one thing dispatch still
  answers there. Otherwise the only undo is a database edit. Same shape as the
  availability `PROTECTED` list: whatever turns a thing off must not be able to
  turn off its own reverse.
- **If the bot does the fetching, the URL is an attack surface.** `,seticon`
  takes a link and requests it from inside the network, so `checkImageUrl`
  refuses loopback, private and link-local ranges, bare hostnames and embedded
  credentials before anything is sent. Postgres, Redis and the callback listener
  all sit on interfaces that gate would otherwise reach.
- **A spec from another bot is a vocabulary, not a feature list.** The rename
  came from a command list the user supplied, and following it literally grew
  the group by eight commands nobody had asked for — a mention-raid switch, an
  allow list for invites, per-filter `reset`s. They came back out. What the
  spec was actually worth was the *naming*: `automod`, `ignore`, `whitelist`,
  `mentions`, `music`. Copy the words, not the inventory.
- ⚠️ **Renaming a command is cheap; renaming a *word* is not.** `,filter`
  became `,automod` by adding an alias, and nobody has to relearn anything. But
  the same pass swapped what two words mean: `whitelist` used to take a word to
  let through and now takes a role to exempt, and the old `exempt` became
  `whitelist`. Aliases cannot save that — `,automod whitelist badword` still
  parses, it just quietly does something else. The only honest fix is to notice
  the shape of the argument: a role that cannot be found, whose name looks like
  a bare word, gets told about `,automod ignore` instead of a flat "I cannot
  find that role."
- ⚠️ **A subcommand under a command that does not dispatch is decoration.**
  `whitelist` calls its handler directly, so `automod music whitelist view`
  arrives at the handler as the argument `view` — which was then looked up as a
  role name and failed. Registering the subcommand made it appear in `,help`
  without making it work, and it had been that way since it was called `exempt
  list`. The handlers now share one `isListWord()`, so every spelling of "show
  me the list" lands in the same branch, whether it came through the registry or
  as a bare word.
- **A doc check must read the docs.** `deploy/docaudit.mjs` pulls the numbers
  out of README.md and ARCHITECTURE.md and compares them to the registry. The
  earlier version hard-coded what it expected, so it reported success twice
  while the prose was stale: updating a test and updating a sentence are
  separate acts. It also fails when a total *disappears*, not only when it is
  wrong.
- **A check nobody runs is a check nobody has.** The audit gates the deploy: it
  runs after the build and before the restart, and a failure exits 1 without
  restarting. The order is the point — the new code is on disk with nothing
  serving it, which is the safe half of a half-done deploy. `--skip-audit` is
  the way out when the docs are mid-rewrite; `--no-build` skips the audit too,
  because it reads `dist/` and checking a stale build would pass for the wrong
  reason.
- ⚠️ **A renamed command does not take its documentation with it.**
  `documented()` matches catalog entries to commands **by name**. Renaming
  `,filter` to `,automod` left a doc called `filter` behind, and because exactly
  one command still answered to that name it was adopted unconditionally: for a
  while `,boosterrole filter` wore the word filter's documentation and sat in
  the Filters section of `,help`. Nothing errored, and the totals stayed right,
  because the doc was still attached to *something*. Rename the catalog entry
  and the `inCategory()` slug in the same commit as the command.
- **Every kind of drift found once becomes a check.** The suite grew from 86 to
  268 that way — every doc entry and every catalog section is now checked
  individually: per-cog counts, the settings table against `.env.example`, events
  in *both* directions, duplicate help slugs, select menus rendered rather than
  counted, and `plain()` call sites asking for more than the escaper gives.
  Each one was a real mistake first. Counting the whole bot never caught any of
  them, because the whole-bot totals were right while the parts were wrong.

  ⚠️ The doc checks catch an **orphan** — a catalog entry no command answers to,
  which is how the dead `snipe` doc was found after the utility cog went. They
  do **not** catch a **misattribution**, where the orphan is adopted by a
  same-named subcommand, because the entry is still attached to a live command
  and nothing about it looks wrong. The obvious test — the command's own
  `inCategory()` slug disagreeing with the doc's — has three deliberate
  exceptions already (`unpin`, `lfurl`, `vote` are filed by hand under a
  different section than their registrar declares), so it would report those
  three every run and teach everyone to ignore it.
- **Never store a credential you can fetch.** A webhook URL is a password that
  needs no account behind it, so `webhooks` has no token column: the token is
  read from Discord at the moment of a send and dropped. The row is worthless on
  its own, and the card never prints the URL either.
- **A record whose subject is gone must still be deletable.** A webhook removed
  on Discord leaves a row here: `send` says so, `list` marks it, and `delete`
  still works. Refusing to act on a dangling record is how a server ends up
  unable to tidy its own settings.
- **Weigh a dependency against the code it saves.** The zip for `,extractemotes`
  is sixty lines of container format plus `zlib.crc32`, against a package on the
  install path forever. Entries are stored, not deflated, because emoji are
  already compressed. A test validates the output with Python's `zipfile` rather
  than with the writer that produced it — a hand-rolled format has to be checked
  by something that did not write it.
- **A slow handler must not be awaited on a shared event.** `emitMessage` runs
  its handlers in order, so anything that does real work has to start it and
  return rather than holding every later hook up on every message.
- **Two paths, so one breaking is not silence.** Extractors break by design of
  the other side, so anything built on one needs somewhere to land — a
  degraded answer beats an error. (Learned from the reposter, since removed.)
- **Bytes do not fit through a JSON body.** `write()` encodes its body as JSON, so
  uploading goes through `sendFile` and `multipart/form-data` instead, with the
  message in a `payload_json` part. The same call carries `components` and `flags`,
  because posting a file plainly and posting it inside a container differ only in
  that payload, and splitting them into two functions would duplicate the transport
  to express a formatting choice.
- **Two halves of one post can live in two places.** A tiktok photo post gets its
  images from the fixer and its counts from yt-dlp, which refuses the photo url but
  answers for the same id in its video form. Fetching twice and joining the halves
  beats showing a post with no numbers on it because one source was incomplete.
- **A URL from a user is fetched by the server, so it is a request the server is
  making.** `customize` resolves the host before fetching and refuses loopback,
  private, link-local and carrier-NAT addresses, and refuses redirects rather than
  following one somewhere the check already rejected. The box runs a database and
  a web server on exactly those addresses.
- **Remember what an API will not tell you twice.** Discord accepts a bio for the
  bot's guild member and echoes it back, but returns it from no endpoint a bot may
  read. It is stored locally so the setting can be shown again, and the display
  says that is where the value came from.
- **A top-level name beats a subcommand of the same name, by design.** `lookup`
  reads the top-level registry first and only then scans group namespaces, so
  registering `,avatar` takes the bare word while `,customize avatar` keeps
  working through its parent. Aliases are the opposite: the registry refuses a
  duplicate and says so, which is how `mc` stayed with `membercount`.
- **A destructive command needs a dispatcher before it needs anything else.**
  `nuke` had none, so `nuke list` fell through to the bare command and deleted
  the channel it was run in. A command whose bare form destroys something must
  refuse an argument it does not recognise rather than treating it as none.
- **A shared counter belongs to the database.** Suggestion numbers are handed out
  by one INSERT ... ON CONFLICT DO UPDATE ... RETURNING, not by counting rows and
  adding one: two people suggesting in the same moment would otherwise be given
  the same number, and the number is the only handle every other command has.
- **Edit the artefact, do not replace it.** A status change rewrites the
  suggestion message in place, because the votes and the thread are attached to
  that message id. Reposting would look identical and quietly discard both.
- **A short link is a question, not an answer.** It is followed before anything is
  decided about it, because the same tiktok short link lands on either a video or a
  photo post and the two share no handling at all. Guessing from the shape of the
  link would be guessing.
- **Reuse the pager rather than inventing a second one.** A photo post pages through
  `paginateWith`, the same Redis-backed state, owner check and buttons every other
  paged view uses; only the send differs, because a repost is not a reply to a
  command. A second pagination system would be a second set of expiry bugs.
- **Shrink it rather than refuse it.** A file a few percent over the upload limit
  is the common case on a server with no boosts, and replacing a video with a link
  to satisfy a ceiling serves nobody. The download is measured on disk and
  re-encoded to fit, because the flag that was supposed to enforce the ceiling
  checks each stream separately and lets unknown sizes through.
- **Ask the middleman for the goods, not for directions.** A rewrite host serves
  tags to crawlers and redirects browsers back to the origin. A downloader that
  impersonates a browser therefore walks back into the block it was sent to avoid,
  so the media url from the tags is fetched directly instead.
- **When the front door is shut, ask the same question of the side door.** A
  service that refuses this address often has a mirror that does not, and giving
  both sources the same return shape means nothing downstream knows or cares
  which answered.
- **A site that cannot be made to work is removed, not matched.** A link that is
  recognised and then does nothing is worse than one that was never claimed, so a
  site that cannot be served leaves the table rather than sitting in it failing.
- **A reported size is not the size you will fetch.** Nothing here checks
  a probe's `filesize` against the upload limit, because it describes the best
  format available rather than the one requested — youtube reports 232MB for a
  20MB download, which silently rejected every youtube link. Limits are enforced
  where the work happens, not from a number that answers a different question.
- **Read back the artefact you asked for.** A tool that writes intermediates into
  the same directory will hand you one if you take the first file you find; the
  a single-extension name is the only one accepted, so a failed merge fails instead
  of posting an audio fragment as a video.
- **Ask the tool what it can do, once, and reuse the answer.** yt-dlp is asked
  to impersonate a browser only after checking that impersonation is installed,
  because requesting it when the library is absent fails every download rather
  than degrading. The check is one memoised promise, not a flag per call and not
  a retry after failure.
- **A short link and a profile link are not the same pattern.** Sites whose
  videos sit at the root of a domain get their own table entry rather than a
  looser pattern on the main one: `clips.twitch.tv/abc` is a clip,
  `twitch.tv/streamer` is not, and one rule covering both would have the bot
  download strangers' profiles. Tumblr is the inverse — a blog per subdomain, matched on a suffix,
  because no list of exact hosts can ever be complete.
- **A field being present is not the answer you wanted.** Every member wearing any
  server's tag carries `primary_guild`; only some of them wear *this* server's.
  The check is on the id and the enabled flag together, because the loose version
  would have rewarded six people here for repping somebody else.
- **A reward that cannot be lost is not a reward.** The sweep takes roles back from
  anybody who stopped wearing the tag, and forgets them, so putting it back on is
  thanked again rather than silently.
- **Refuse an impossible setting when it is set, not when it is used.** A role
  above the bot cannot be granted; catching that as it is added gives one person
  one clear sentence, while catching it at sync time gives nobody anything.
- **Failing open is not always failing safe.** Most providers here return "not
  blocked" when they cannot answer. The limit provider returns the *defaults*
  instead: a database that cannot be reached is a reason to keep the guard rather
  than to drop it, and the cost of being wrong is a slow user rather than an
  unguarded bot.
- **Two settings that constrain each other are validated against each other.** A
  per-person limit above the server ceiling is unreachable, and a ceiling below it
  lets one person exhaust the server's whole allowance. Both are refused with the
  reason, rather than stored and left to behave strangely.
- **A limit on commands is not a limit on the bot.** The throttle sits in the
  command dispatch path, so the features that fire on an ordinary message — the
  autoresponder on a word, the antinuke's webhook watch on a mass-mention, the
  filter on anything — never reach it and keep their own per-trigger cooldowns. Two layers guarding two
  doors, not one job done twice.
- **A refusal must be quieter than the thing it refuses.** The command limit tells
  somebody once and then drops them in silence, because answering every command in
  a flood makes the bot the loudest thing in the channel. The same reasoning keeps
  the per-server ceiling silent entirely: explaining it to each of twenty raiders
  is twenty more messages.
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
