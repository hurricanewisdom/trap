import { editChannel, getChannel } from "../../../core/discord.js";
import { onMemberJoin } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { PLATFORMS, platformFor, read, type Reading } from "./sources.js";
import {
  CYCLE_MS,
  MAX_PER_GUILD,
  allCounters,
  clearCounters,
  countersIn,
  counterFor,
  markUpdated,
  noteJoin,
  removeCounter,
  setCounter,
  type Kind,
} from "./store.js";
import { FILTERS, NAME_LIMIT, VARIABLES, apply, serverValues, unknownTokens } from "./template.js";

const HEADING = "Counters";

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

const DEFAULT_SERVER = "{members} members +{joins_today} td";

/** A text channel lowercases its name and turns spaces into dashes, so a
 * counter reads properly only on a voice channel or a category. */
const KEEPS_FORMATTING = new Set([2, 4, 13]);

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function channelId(token: string | undefined): string | null {
  const mention = CHANNEL_MENTION.exec(token ?? "");
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token ?? "") ? (token as string) : null;
}

async function valuesFor(guildId: string, kind: Kind, handle: string | null): Promise<Reading | null> {
  const server = await serverValues(guildId);
  if (kind === "server") return server;

  const got = await read(kind, handle ?? "");
  return got ? { ...server, ...got } : null;
}

function knownTokens(kind: Kind): string[] {
  const base = VARIABLES.map((one) => one.token);
  const platform = platformFor(kind);
  return platform ? [...base, ...platform.fields.map((one) => one.token)] : base;
}

/** Renames one channel, unless the name has not changed. */
async function paint(guildId: string, channelId: string): Promise<string | null> {
  const held = await counterFor(channelId);
  if (!held) return null;

  const values = await valuesFor(guildId, held.kind, held.handle);
  if (!values) return null;

  const name = apply(held.template, values);
  if (!name) return null;

  // A rename that changes nothing still spends one of the two Discord allows
  // in ten minutes, so an unchanged name is not sent at all.
  if (name === held.lastName) return name;

  const done = await editChannel(channelId, { name }, "Counter update");
  if (!done.ok) return null;

  await markUpdated(channelId, name);
  return name;
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the counters");
  if (!guildId) return;

  const held = await countersIn(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `${held.length} channel${held.length === 1 ? "" : "s"} showing live figures.`
        : "No channel is showing a counter yet.",
      "",
      "`counter add #channel {members} members` starts one",
      "`counter preview <template>` tries a template without making anything",
      "`counter variables` lists what a template can use",
      "",
      `-# Discord allows two renames per channel per ten minutes, so a counter updates every ${CYCLE_MS / 60000}.`,
    ].join("\n"),
  );
}

/** The shared setup path: every platform command is this with a kind bound. */
async function configure(
  ctx: PrefixContext,
  kind: Kind,
  needsHandle: boolean,
): Promise<void> {
  const platform = platformFor(kind);
  const guildId = await requireManageGuild(
    ctx,
    `set up a ${platform ? platform.label : "server"} counter`,
  );
  if (!guildId) return;

  if (platform?.needs) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `I cannot read ${platform.label} figures.`,
        `-# ${platform.needs}.`,
        "",
        "-# `counter socialvars` lists the platforms that do work.",
      ].join("\n"),
    );
    return;
  }

  const tokens = words(ctx.argument);
  const channel = channelId(tokens[0]) ?? channelId(tokens[0] === undefined ? "" : tokens[0]);
  if (channel) tokens.shift();

  const target = channel ?? ctx.channelId;
  const handle = needsHandle ? tokens.shift() ?? "" : null;
  if (needsHandle && !handle) {
    await card(
      ctx,
      [`### ${HEADING}`, `Give me ${platform?.takes ?? "an account"}.`].join("\n"),
    );
    return;
  }

  const template =
    tokens.join(" ").trim() || platform?.fallback || DEFAULT_SERVER;

  const held = await countersIn(guildId);
  if (!held.some((one) => one.channelId === target) && held.length >= MAX_PER_GUILD) {
    await card(ctx, [`### ${HEADING}`, `That is ${MAX_PER_GUILD} counters already.`].join("\n"));
    return;
  }

  const found = await getChannel(target);
  if (!found) {
    await card(ctx, [`### ${HEADING}`, "I cannot see that channel."].join("\n"));
    return;
  }

  // Read it once before storing, so a bad handle is caught here rather than
  // becoming a channel that never updates.
  const values = await valuesFor(guildId, kind, handle);
  if (!values) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `I could not read anything for \`${handle}\` on ${platform?.label ?? "that platform"}.`,
        "-# Check the name, or try again in a moment.",
      ].join("\n"),
    );
    return;
  }

  const unknown = unknownTokens(template, knownTokens(kind));
  await setCounter(guildId, target, kind, handle, template.slice(0, 200));
  const name = await paint(guildId, target);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      name ? `<#${target}> now reads **${name}**.` : `<#${target}> is set up, but I could not rename it.`,
      unknown.length
        ? `-# \`${unknown.join("` `")}\` ${unknown.length === 1 ? "is not a variable" : "are not variables"} here, so ${unknown.length === 1 ? "it is" : "they are"} left as typed.`
        : "",
      KEEPS_FORMATTING.has(found.type ?? -1)
        ? ""
        : "-# ⚠️ A text channel lowercases its name and turns spaces into dashes. A voice channel or a category keeps the formatting.",
      `-# Updates every ${CYCLE_MS / 60000} minutes.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the counters");
  if (!guildId) return;

  const held = await countersIn(guildId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No channel is showing a counter yet."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held
        .map(
          (one) =>
            `<#${one.channelId}> — \`${one.kind}\`${one.handle ? ` \`${one.handle}\`` : ""}\n-# \`${one.template}\``,
        )
        .join("\n"),
      "",
      `-# ${held.length} of ${MAX_PER_GUILD}`,
    ].join("\n"),
  );
}

async function view(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "read a counter's template");
  if (!guildId) return;

  const target = channelId(words(ctx.argument)[0]);
  const held = target ? await counterFor(target) : null;
  if (!held) {
    await card(ctx, [`### ${HEADING}`, "Name a channel that is showing a counter."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${held.channelId}> — \`${held.kind}\`${held.handle ? ` \`${held.handle}\`` : ""}`,
      "",
      `>>> ${held.template}`,
      held.lastName ? `-# Currently reads **${held.lastName}**.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function preview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "preview a template");
  if (!guildId) return;

  const template = ctx.argument.trim();
  if (!template) {
    await card(ctx, [`### ${HEADING}`, "Give me a template to try."].join("\n"));
    return;
  }

  const values = await serverValues(guildId);
  const unknown = unknownTokens(template, VARIABLES.map((one) => one.token));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `That would read **${apply(template, values)}**`,
      unknown.length ? `-# \`${unknown.join("` `")}\` left as typed — a platform counter fills its own in.` : "",
      `-# Channel names stop at ${NAME_LIMIT} characters.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function refresh(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "refresh a counter");
  if (!guildId) return;

  const target = channelId(words(ctx.argument)[0]);
  const held = target ? await counterFor(target) : null;
  if (!held || !target) {
    await card(ctx, [`### ${HEADING}`, "Name a channel that is showing a counter."].join("\n"));
    return;
  }

  const name = await paint(guildId, target);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      name
        ? `<#${target}> reads **${name}**.`
        : "That did not update. Either the source could not be read, or Discord is throttling the rename.",
      name === held.lastName ? "-# It already read that, so nothing was sent." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a counter");
  if (!guildId) return;

  const target = channelId(words(ctx.argument)[0]);
  if (!target) {
    await card(ctx, [`### ${HEADING}`, "Name the channel to stop updating."].join("\n"));
    return;
  }

  const gone = await removeCounter(target);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone
        ? `<#${target}> is no longer updated. Its name is left as it is.`
        : "That channel was not showing a counter.",
    ].join("\n"),
  );
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "clear the counters");
  if (!guildId) return;

  const gone = await clearCounters(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone === 0 ? "There were no counters." : `Stopped updating ${gone} channel${gone === 1 ? "" : "s"}.`,
      gone ? "-# Their names are left as they are." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function variables(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the counter variables");
  if (!guildId) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Every counter can use these:",
      VARIABLES.map((one) => `\`${one.token}\` — ${one.describes}`).join("\n"),
      "",
      `Add \`|${FILTERS.join("` or `|")}\` to a number: \`{members|human}\` gives 1.2K, \`|comma\` gives 1,234.`,
      "`{if: {live} && shown when true && shown when false}` picks between two.",
      "",
      "-# `counter socialvars` lists what each platform adds.",
    ].join("\n"),
  );
}

async function socialvars(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the platform variables");
  if (!guildId) return;

  const asked = words(ctx.argument)[0]?.toLowerCase();
  const shown = asked ? PLATFORMS.filter((one) => one.kind.startsWith(asked)) : PLATFORMS;

  if (shown.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, `I do not track \`${asked}\`.`, `-# ${PLATFORMS.map((o) => o.kind).join(", ")}`].join("\n"),
    );
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      ...shown.map((one) =>
        [
          `**${one.label}** — \`counter ${one.kind}\``,
          one.needs
            ? `-# ⚠️ Not available: ${one.needs}.`
            : one.fields.map((f) => `\`${f.token}\` ${f.describes}`).join(" · "),
        ].join("\n"),
      ),
      "",
      "-# Every platform counter can also use the server variables.",
    ].join("\n"),
  );
}

/**
 * One pass over every counter in the bot.
 *
 * Sequential on purpose: each rename is its own Discord bucket, but the source
 * fetches are ordinary web requests and firing dozens at once from one box is
 * how a scraper gets blocked.
 */
async function cycle(): Promise<void> {
  const held = await allCounters();
  for (const { guildId, counter } of held) {
    try {
      await paint(guildId, counter.channelId);
    } catch (error) {
      console.error(`counter: ${counter.channelId} failed`, error);
    }
  }
}

export function registerCounters(): void {
  onMemberJoin(async (event) => {
    await noteJoin(event.guildId);
  });

  const timer = setInterval(() => {
    void cycle();
  }, CYCLE_MS);
  timer.unref();

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("counter", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "counter",
    aliases: ["cntr", "counters"],
    description: "Create channels that display dynamic server statistics",
    handler,
  });

  groupUnder("counter", () => {
    register({
      name: "add",
      aliases: ["create", "set"],
      description: "Add or update a counter channel with a custom template",
      handler: (ctx) => configure(ctx, "server", false),
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all counter channels configured in this server",
      handler: clear,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View all counter channels and their templates",
      handler: list,
    });

    register({
      name: "preview",
      aliases: ["test", "demo"],
      description: "Preview what a template would resolve to",
      handler: preview,
    });

    register({
      name: "refresh",
      aliases: ["update", "force"],
      description: "Force-update a counter channel immediately",
      handler: refresh,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Stop a channel from being updated as a counter",
      handler: remove,
    });

    register({
      name: "socialvars",
      aliases: ["svars", "social-vars"],
      description: "View the template variables for social counter platforms",
      handler: socialvars,
    });

    register({
      name: "variables",
      aliases: ["vars"],
      description: "View all available template variables",
      handler: variables,
    });

    register({
      name: "view",
      aliases: ["script", "template"],
      description: "View the template for a counter channel",
      handler: view,
    });

    for (const [name, aliases, kind] of [
      ["instagram", ["ig", "insta"], "instagram"],
      ["soundcloud", ["sc"], "soundcloud"],
      ["soundcloudtrack", ["sctrack", "sct"], "soundcloudtrack"],
      ["spotify", ["sp", "so"], "spotify"],
      ["tiktok", ["tt"], "tiktok"],
      ["twitch", ["tv"], "twitch"],
      ["twitter", ["x", "tw"], "twitter"],
      ["youtube", ["yt"], "youtube"],
    ] as [string, string[], Kind][]) {
      const platform = platformFor(kind);
      register({
        name,
        aliases,
        description: `Track ${platform?.label ?? name} stats in a counter channel`,
        handler: (ctx) => configure(ctx, kind, true),
      });
    }
  });
}
