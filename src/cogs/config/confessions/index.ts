import { channelExists, guildRoles, sendMessage } from "../../../core/discord.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { humanDuration, parseDuration } from "../../../helpers/duration.js";
import { switchWord } from "../../../helpers/flags.js";
import { CONFESSION_LIMIT, submitRow, watchConfessions } from "./flow.js";
import {
  DEFAULT_BUTTON,
  DEFAULT_REPLY,
  DEFAULT_REPLY_BUTTON,
  DEFAULT_TEMPLATE,
  addTo,
  clearList,
  listOf,
  removeFrom,
  set,
  settings,
  type Field,
  type ListKind,
} from "./store.js";

const HEADING = "Confessions";

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const USER_MENTION = /^<@!?(\d{15,25})>$/;

const STYLES: Record<string, number> = {
  primary: 1,
  blurple: 1,
  secondary: 2,
  grey: 2,
  gray: 2,
  success: 3,
  green: 3,
  danger: 4,
  red: 4,
};

function styleName(value: number): string {
  if (value === 1) return "primary";
  if (value === 3) return "success";
  if (value === 4) return "danger";
  return "secondary";
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function idFrom(token: string | undefined, pattern: RegExp): string | null {
  const mention = pattern.exec(token ?? "");
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token ?? "") ? (token as string) : null;
}

async function gate(ctx: PrefixContext, action: string): Promise<string | null> {
  return requireManageGuild(ctx, action);
}

/* ------------------------------------------------------------------ channels */

/** `channel`, `review` and `log` are the same three commands three times. */
function channelSetter(field: Field, label: string, what: string) {
  const setIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `set the ${what}`);
    if (!guildId) return;

    const id = idFrom(words(ctx.argument)[0], CHANNEL_MENTION);
    if (!id) {
      await card(ctx, [`### ${HEADING}`, `Name a channel: \`confessions ${label} #channel\`.`].join("\n"));
      return;
    }
    if (!(await channelExists(guildId, id))) {
      await card(ctx, [`### ${HEADING}`, "I cannot see that channel."].join("\n"));
      return;
    }

    await set(guildId, field, id);
    await card(ctx, [`### ${HEADING}`, `The ${what} is <#${id}>.`].join("\n"));
  };

  const removeIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `clear the ${what}`);
    if (!guildId) return;
    await set(guildId, field, null);
    await card(ctx, [`### ${HEADING}`, `The ${what} is cleared.`].join("\n"));
  };

  const viewIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `see the ${what}`);
    if (!guildId) return;

    const held = await settings(guildId);
    const id =
      field === "channel_id"
        ? held.channelId
        : field === "review_channel_id"
          ? held.reviewChannelId
          : held.logChannelId;

    await card(
      ctx,
      [`### ${HEADING}`, id ? `The ${what} is <#${id}>.` : `No ${what} is set.`].join("\n"),
    );
  };

  return { setIt, removeIt, viewIt };
}

/* ----------------------------------------------------------------- durations */

function durationSetter(field: "min_account_age_ms" | "cooldown_ms", what: string) {
  const setIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `set the ${what}`);
    if (!guildId) return;

    const ms = parseDuration(ctx.argument.trim());
    if (ms === null) {
      await card(
        ctx,
        [`### ${HEADING}`, "Give me a length of time, like `7d`, `12h` or `30m`."].join("\n"),
      );
      return;
    }

    await set(guildId, field, ms);
    await card(ctx, [`### ${HEADING}`, `The ${what} is **${humanDuration(ms)}**.`].join("\n"));
  };

  const removeIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `clear the ${what}`);
    if (!guildId) return;
    await set(guildId, field, null);
    await card(ctx, [`### ${HEADING}`, `There is no ${what} now.`].join("\n"));
  };

  const viewIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `see the ${what}`);
    if (!guildId) return;

    const held = await settings(guildId);
    const ms = field === "cooldown_ms" ? held.cooldownMs : held.minAccountAgeMs;
    await card(
      ctx,
      [`### ${HEADING}`, ms === null ? `There is no ${what}.` : `The ${what} is **${humanDuration(ms)}**.`].join("\n"),
    );
  };

  return { setIt, removeIt, viewIt };
}

/* ------------------------------------------------------------------- toggles */

function toggle(field: "anonymous" | "allow_images" | "allow_links" | "filter_on", what: string) {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `change ${what.toLowerCase()}`);
    if (!guildId) return;

    const state = switchWord(words(ctx.argument)[0] ?? "");
    if (state === null) {
      const held = await settings(guildId);
      const on =
        field === "anonymous"
          ? held.anonymous
          : field === "allow_images"
            ? held.allowImages
            : field === "allow_links"
              ? held.allowLinks
              : held.filterOn;
      await card(
        ctx,
        [`### ${HEADING}`, `${what} — **${on ? "on" : "off"}**.`, "", "-# `on` or `off` changes it."].join("\n"),
      );
      return;
    }

    await set(guildId, field, state);
    await card(ctx, [`### ${HEADING}`, `${what} — **${state ? "on" : "off"}**.`].join("\n"));
  };
}

/* --------------------------------------------------------------------- lists */

function roleList(kind: ListKind, what: string, path: string) {
  const addOrRemove = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `change ${what}`);
    if (!guildId) return;

    const token = words(ctx.argument)[0];
    if (!token) {
      await viewIt(ctx);
      return;
    }

    const id = idFrom(token, ROLE_MENTION);
    const role = id ? (await guildRoles(guildId)).find((one) => one.id === id) : null;
    if (!role) {
      await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
      return;
    }

    // Running it bare on a role toggles, which is what the spec's single
    // `ping <role>` has to mean when there is also a `ping remove`.
    const held = await listOf(guildId, kind);
    if (held.includes(role.id)) {
      await removeFrom(guildId, kind, role.id);
      await card(ctx, [`### ${HEADING}`, `<@&${role.id}> is no longer ${what}.`].join("\n"));
      return;
    }

    await addTo(guildId, kind, role.id);
    await card(ctx, [`### ${HEADING}`, `<@&${role.id}> is now ${what}.`].join("\n"));
  };

  const removeIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `change ${what}`);
    if (!guildId) return;

    const id = idFrom(words(ctx.argument)[0], ROLE_MENTION);
    if (!id) {
      await card(ctx, [`### ${HEADING}`, "Name the role to remove."].join("\n"));
      return;
    }

    const gone = await removeFrom(guildId, kind, id);
    await card(
      ctx,
      [`### ${HEADING}`, gone ? `<@&${id}> is no longer ${what}.` : "That role was not on the list."].join("\n"),
    );
  };

  const clearIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `clear ${what}`);
    if (!guildId) return;

    const gone = await clearList(guildId, kind);
    await card(
      ctx,
      [`### ${HEADING}`, gone === 0 ? `No role was ${what}.` : `${gone} removed.`].join("\n"),
    );
  };

  const viewIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `see ${what}`);
    if (!guildId) return;

    const held = await listOf(guildId, kind);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        held.length ? held.map((id) => `<@&${id}>`).join(" · ") : `No role is ${what}.`,
        "",
        `-# \`${path} <role>\` adds or removes one.`,
      ].join("\n"),
    );
  };

  return { addOrRemove, removeIt, clearIt, viewIt };
}

/* -------------------------------------------------------------------- script */

function scriptSetter(field: "template" | "reply_template", what: string, fallback: string) {
  const setIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `set the ${what}`);
    if (!guildId) return;

    const body = ctx.argument.trim();
    if (!body) {
      const held = await settings(guildId);
      await card(
        ctx,
        [
          `### ${HEADING}`,
          `The ${what} is:`,
          `>>> ${field === "template" ? held.template : held.replyTemplate}`,
          "",
          "-# `{number}` and `{content}` are what it can use.",
        ].join("\n"),
      );
      return;
    }

    await set(guildId, field, body.slice(0, 1000));
    await card(
      ctx,
      [`### ${HEADING}`, `The ${what} is now:`, `>>> ${body.slice(0, 1000)}`].join("\n"),
    );
  };

  const removeIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `reset the ${what}`);
    if (!guildId) return;
    await set(guildId, field, null);
    await card(ctx, [`### ${HEADING}`, `The ${what} is back to:`, `>>> ${fallback}`].join("\n"));
  };

  return { setIt, removeIt };
}

/* ------------------------------------------------------------------- buttons */

function buttonSetter(
  styleField: "button_style" | "reply_button_style",
  labelField: "button_label" | "reply_button_label",
  what: string,
  fallback: { style: number; label: string },
) {
  const setIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `change the ${what}`);
    if (!guildId) return;

    const tokens = words(ctx.argument);
    const style = STYLES[(tokens[0] ?? "").toLowerCase()];
    if (style === undefined) {
      await card(
        ctx,
        [`### ${HEADING}`, "Start with a style: `primary`, `secondary`, `success` or `danger`."].join("\n"),
      );
      return;
    }

    const label = tokens.slice(1).join(" ").trim();
    if (!label) {
      await card(ctx, [`### ${HEADING}`, "Give the button a label as well."].join("\n"));
      return;
    }

    await set(guildId, styleField, style);
    await set(guildId, labelField, label.slice(0, 80));
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `The ${what} is ${styleName(style)}, reading "${label.slice(0, 80)}".`,
        styleField === "button_style" ? "-# `confessions panel` posts it again with the new look." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };

  const removeIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `remove the ${what}`);
    if (!guildId) return;

    // A null label is what switches the button off, so the renderer has one
    // thing to check rather than a second column that can disagree with it.
    await set(guildId, labelField, null);
    await card(ctx, [`### ${HEADING}`, `The ${what} is gone.`].join("\n"));
  };

  const viewIt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await gate(ctx, `see the ${what}`);
    if (!guildId) return;

    const held = await settings(guildId);
    const style = styleField === "button_style" ? held.buttonStyle : held.replyButtonStyle;
    const label = labelField === "button_label" ? held.buttonLabel : held.replyButtonLabel;

    await card(
      ctx,
      [
        `### ${HEADING}`,
        label
          ? `The ${what} is ${styleName(style)}, reading "${label}".`
          : `There is no ${what}. The default was ${styleName(fallback.style)} "${fallback.label}".`,
      ].join("\n"),
    );
  };

  return { setIt, removeIt, viewIt };
}

/* -------------------------------------------------------------------- others */

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "see the confessions settings");
  if (!guildId) return;

  const held = await settings(guildId);
  const [blacklist, pings, reviewPings, filtered] = await Promise.all([
    listOf(guildId, "blacklist"),
    listOf(guildId, "ping"),
    listOf(guildId, "review_ping"),
    listOf(guildId, "word"),
  ]);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.channelId ? `Posted in <#${held.channelId}>.` : "⚠️ No confession channel is set, so nothing can be submitted.",
      held.reviewChannelId ? `Reviewed in <#${held.reviewChannelId}> before posting.` : "Posted straight away, with no review.",
      held.logChannelId ? `Logged in <#${held.logChannelId}>.` : "Not logged, so nobody can be traced.",
      "",
      `Anonymous in review: **${held.anonymous ? "yes" : "no"}** · Images: **${held.allowImages ? "allowed" : "no"}** · Links: **${held.allowLinks ? "allowed" : "no"}**`,
      `Account age: **${held.minAccountAgeMs === null ? "any" : humanDuration(held.minAccountAgeMs)}** · Cooldown: **${held.cooldownMs === null ? "none" : humanDuration(held.cooldownMs)}**`,
      `Word filter: **${held.filterOn ? "on" : "off"}**, ${filtered.length} word${filtered.length === 1 ? "" : "s"} · Blacklisted: **${blacklist.length}** · Pinged: **${pings.length}**, review **${reviewPings.length}**`,
      "",
      "-# `confessions panel` posts the submit button once everything is set.",
    ].join("\n"),
  );
}

async function panel(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "post the confession panel");
  if (!guildId) return;

  const held = await settings(guildId);
  if (!held.channelId) {
    await card(
      ctx,
      [`### ${HEADING}`, "Set a confession channel first: `confessions channel #channel`."].join("\n"),
    );
    return;
  }
  if (!held.buttonLabel) {
    await card(
      ctx,
      [`### ${HEADING}`, "The submit button is switched off. `confessions button <style> <label>` brings it back."].join("\n"),
    );
    return;
  }

  const sent = await sendMessage(held.channelId, {
    content: "Press the button to submit a confession. Nobody sees who sent it.",
    components: submitRow(held),
  });

  await card(
    ctx,
    [
      `### ${HEADING}`,
      sent.ok ? `Posted in <#${held.channelId}>.` : "I could not post there.",
      sent.ok ? `-# Confessions are at most ${CONFESSION_LIMIT} characters.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function blacklist(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "change the confessions blacklist");
  if (!guildId) return;

  const token = words(ctx.argument)[0];
  if (!token) {
    await blacklistView(ctx);
    return;
  }

  const id = idFrom(token, USER_MENTION) ?? idFrom(token, ROLE_MENTION);
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name a member or a role."].join("\n"));
    return;
  }

  const held = await listOf(guildId, "blacklist");
  if (held.includes(id)) {
    await removeFrom(guildId, "blacklist", id);
    await card(ctx, [`### ${HEADING}`, `<@${id}> can submit again.`].join("\n"));
    return;
  }

  await addTo(guildId, "blacklist", id);
  await card(ctx, [`### ${HEADING}`, `<@${id}> can no longer submit confessions.`].join("\n"));
}

async function blacklistView(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "see the confessions blacklist");
  if (!guildId) return;

  const held = await listOf(guildId, "blacklist");
  const roles = new Set((await guildRoles(guildId)).map((one) => one.id));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? held.map((id) => (roles.has(id) ? `<@&${id}>` : `<@${id}>`)).join(" · ")
        : "Nobody is blacklisted.",
      "",
      "-# `confessions blacklist @someone` adds or removes one.",
    ].join("\n"),
  );
}

async function blacklistClear(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "clear the confessions blacklist");
  if (!guildId) return;

  const gone = await clearList(guildId, "blacklist");
  await card(
    ctx,
    [`### ${HEADING}`, gone === 0 ? "Nobody was blacklisted." : `${gone} removed.`].join("\n"),
  );
}

async function filterWord(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "change the confessions word filter");
  if (!guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  if (!word) {
    await filterView(ctx);
    return;
  }

  const held = await listOf(guildId, "word");
  if (held.includes(word)) {
    await removeFrom(guildId, "word", word);
    await card(ctx, [`### ${HEADING}`, `\`${word}\` is no longer filtered.`].join("\n"));
    return;
  }

  await addTo(guildId, "word", word);
  await card(ctx, [`### ${HEADING}`, `\`${word}\` is filtered.`].join("\n"));
}

async function filterView(ctx: PrefixContext): Promise<void> {
  const guildId = await gate(ctx, "see the confessions word filter");
  if (!guildId) return;

  const held = await listOf(guildId, "word");
  const one = await settings(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length ? held.map((word) => `\`${word}\``).join(" · ") : "No word is filtered.",
      "",
      `-# The filter is **${one.filterOn ? "on" : "off"}**. \`confessions filter status off\` switches it without clearing it.`,
    ].join("\n"),
  );
}

export function registerConfessions(): void {
  watchConfessions();

  const channel = channelSetter("channel_id", "channel", "confession channel");
  const review = channelSetter("review_channel_id", "review", "confession review channel");
  const log = channelSetter("log_channel_id", "log", "confession log channel");
  const age = durationSetter("min_account_age_ms", "minimum account age");
  const cooldown = durationSetter("cooldown_ms", "confession cooldown");
  const ping = roleList("ping", "pinged for confessions", "confessions ping");
  const reviewPing = roleList("review_ping", "notified about reviews", "confessions review ping");
  const template = scriptSetter("template", "confession script", DEFAULT_TEMPLATE);
  const reply = scriptSetter("reply_template", "reply script", DEFAULT_REPLY);
  const button = buttonSetter("button_style", "button_label", "submit button", DEFAULT_BUTTON);
  const replyButton = buttonSetter(
    "reply_button_style",
    "reply_button_label",
    "reply button",
    DEFAULT_REPLY_BUTTON,
  );

  const dispatcher = (path: string, fallback: PrefixHandler): PrefixHandler =>
    async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn(path, sub) : undefined;

      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
        return;
      }
      await fallback(ctx);
    };

  register({
    name: "confessions",
    aliases: ["confession", "conf", "cnf"],
    description: "Manage the confessions system",
    handler: dispatcher("confessions", overview),
  });

  groupUnder("confessions", () => {
    register({ name: "age", aliases: ["accountage", "account", "minage", "minimumage"], description: "Set the minimum account age required to submit confessions", handler: dispatcher("confessions age", age.setIt) });
    register({ name: "anonymous", aliases: ["anon", "anonymize", "anonymise", "hide"], description: "Set whether confessions should be anonymized during review", handler: toggle("anonymous", "Anonymity in review") });
    register({ name: "blacklist", aliases: ["ignore", "block", "bl", "allow"], description: "Blacklist a member or role from submitting confessions", handler: dispatcher("confessions blacklist", blacklist) });
    register({ name: "blacklisted", aliases: ["ignored"], description: "View the members and roles blacklisted", handler: blacklistView });
    register({ name: "button", aliases: ["submitbutton"], description: "Customize the submit confession button", handler: dispatcher("confessions button", button.setIt) });
    register({ name: "channel", aliases: ["set", "forward", "ch", "c"], description: "Set the channel to forward confessions to", handler: dispatcher("confessions channel", channel.setIt) });
    register({ name: "cooldown", aliases: ["cd", "delay", "wait"], description: "Set the cooldown between confessions for each user", handler: dispatcher("confessions cooldown", cooldown.setIt) });
    register({ name: "filter", aliases: ["wordfilter", "words", "wf"], description: "Add or remove a word from the word filter", handler: dispatcher("confessions filter", filterWord) });
    register({ name: "images", aliases: ["image", "img", "pics", "pictures", "attachments", "attachment", "files", "file"], description: "Set whether confessions can contain images and attachments", handler: toggle("allow_images", "Image links in confessions") });
    register({ name: "links", aliases: ["link", "urls", "url", "websites", "website"], description: "Set whether confessions can contain links", handler: toggle("allow_links", "Links in confessions") });
    register({ name: "log", aliases: ["logs", "logging"], description: "Set the channel to log confessions to", handler: dispatcher("confessions log", log.setIt) });
    register({ name: "panel", aliases: ["post", "send", "setup", "create"], description: "Post the confession submission button", handler: panel });
    register({ name: "ping", aliases: ["mention", "role", "roles", "notify", "notification"], description: "Add or remove a role to be pinged in the confession message", handler: dispatcher("confessions ping", ping.addOrRemove) });
    register({ name: "reply", aliases: ["replyscript", "replytemplate"], description: "Set the script used to render replies", handler: dispatcher("confessions reply", reply.setIt) });
    register({ name: "replybutton", description: "Customize the reply button", handler: dispatcher("confessions replybutton", replyButton.setIt) });
    register({ name: "review", aliases: ["approve", "moderate", "mod", "rev"], description: "Set the channel to review confessions in", handler: dispatcher("confessions review", review.setIt) });
    register({ name: "settings", aliases: ["config", "cfg", "configuration", "overview", "view", "ov"], description: "View the current confessions configuration", handler: overview });
    register({ name: "template", aliases: ["script"], description: "Set the script used to render confessions", handler: dispatcher("confessions template", template.setIt) });
  });

  const REMOVE = ["delete", "del", "rm", "disable", "off"];
  const SHOW = ["show", "current"];

  groupUnder("confessions age", () => {
    register({ name: "remove", aliases: REMOVE, description: "Remove the minimum account age required", handler: age.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current minimum account age required", handler: age.viewIt });
  });

  groupUnder("confessions blacklist", () => {
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all members and roles from the confessions blacklist", handler: blacklistClear });
    register({ name: "view", aliases: ["list"], description: "View the channels, members, and roles blacklisted", handler: blacklistView });
  });

  groupUnder("confessions button", () => {
    register({ name: "remove", aliases: REMOVE, description: "Entirely remove the submit confession button", handler: button.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current submit confession button", handler: button.viewIt });
  });

  groupUnder("confessions channel", () => {
    register({ name: "remove", aliases: REMOVE, description: "Remove the channel designated for confessions", handler: channel.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current confession channel", handler: channel.viewIt });
  });

  groupUnder("confessions cooldown", () => {
    register({ name: "remove", aliases: REMOVE, description: "Remove the cooldown between confessions", handler: cooldown.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current cooldown between confessions", handler: cooldown.viewIt });
  });

  groupUnder("confessions filter", () => {
    register({ name: "status", aliases: ["toggle", "enable", "disable"], description: "Enable or disable the word filter without clearing it", handler: toggle("filter_on", "The word filter") });
    register({ name: "view", aliases: ["list", ...SHOW], description: "View words that are being filtered", handler: filterView });
  });

  groupUnder("confessions log", () => {
    register({ name: "remove", aliases: REMOVE, description: "Remove the channel designated for logging confessions", handler: log.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current confession log channel", handler: log.viewIt });
  });

  groupUnder("confessions ping", () => {
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all roles being pinged for confessions", handler: ping.clearIt });
    register({ name: "remove", aliases: REMOVE, description: "Remove a role from being pinged in the confession message", handler: ping.removeIt });
    register({ name: "view", aliases: ["list", ...SHOW], description: "View the roles being pinged for confessions", handler: ping.viewIt });
  });

  groupUnder("confessions reply", () => {
    register({ name: "remove", aliases: ["delete", "del", "rm", "reset"], description: "Reset the reply script to the default", handler: reply.removeIt });
  });

  groupUnder("confessions replybutton", () => {
    register({ name: "remove", aliases: REMOVE, description: "Entirely remove the reply button", handler: replyButton.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current reply button", handler: replyButton.viewIt });
  });

  groupUnder("confessions review", () => {
    register({ name: "ping", aliases: ["notify", "notification", "mention"], description: "Add a role to be notified when a confession is under review", handler: dispatcher("confessions review ping", reviewPing.addOrRemove) });
    register({ name: "remove", aliases: REMOVE, description: "Remove the channel designated for reviewing confessions", handler: review.removeIt });
    register({ name: "view", aliases: SHOW, description: "View the current confession review channel", handler: review.viewIt });
  });

  groupUnder("confessions review ping", () => {
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all roles being notified about reviews", handler: reviewPing.clearIt });
    register({ name: "remove", aliases: REMOVE, description: "Remove a role from being notified about reviews", handler: reviewPing.removeIt });
    register({ name: "view", aliases: ["list", ...SHOW], description: "View the roles being notified about reviews", handler: reviewPing.viewIt });
  });

  groupUnder("confessions template", () => {
    register({ name: "remove", aliases: ["delete", "del", "rm", "reset"], description: "Reset the confession script to the default", handler: template.removeIt });
  });
}
