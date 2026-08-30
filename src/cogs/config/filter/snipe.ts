import { requireManageChannels } from "../../../core/permissions.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { clearSnipes, provideSnipeGate } from "../../../core/sniping.js";
import { parseFlags, switchWord } from "../../../helpers/flags.js";
import { card, channelId, words } from "./shared.js";
import { settingsFor, setChannel, setEnabled } from "./store.js";

const LABEL = "Snipe filter";

const KIND = "snipe";

async function status(ctx: PrefixContext, guildId: string): Promise<void> {
  const held = await settingsFor(guildId, KIND);

  await card(
    ctx,
    [
      `### ${LABEL}`,
      held.enabled
        ? "On. Deleted messages, edits and removed reactions are not kept, so nothing can be sniped."
        : "Off. `snipe` can show what was deleted or edited here.",
      held.exemptChannels.length
        ? `Still snipeable in ${held.exemptChannels.map((id) => `<#${id}>`).join(" · ")}.`
        : "",
      "",
      "`filter snipe on` or `off` switches it",
      "`filter snipe #channel off` keeps one channel snipeable",
      "",
      "-# Switching it on also clears whatever is already stored.",
      "-# Anything the bot deletes itself is never snipeable, whatever this says.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function main(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the snipe filter");
  if (!guildId) return;

  const { rest } = parseFlags(ctx.argument);
  const parts = words(rest);

  if (parts.length === 0) {
    await status(ctx, guildId);
    return;
  }

  const channel = parts[0] ? channelId(parts[0]) : null;
  const state = parts[channel ? 1 : 0] ? switchWord(parts[channel ? 1 : 0] as string) : null;

  if (channel) {
    if (state === null) {
      await card(ctx, [`### ${LABEL}`, "Use `filter snipe #channel on` or `off`."].join("\n"));
      return;
    }
    await setChannel(guildId, KIND, channel, !state);
    if (state) clearSnipes(guildId, channel);
    await card(
      ctx,
      [
        `### ${LABEL}`,
        state ? `<#${channel}> is no longer snipeable.` : `<#${channel}> stays snipeable.`,
      ].join("\n"),
    );
    return;
  }

  if (state === null) {
    await status(ctx, guildId);
    return;
  }

  await setEnabled(guildId, KIND, state);
  if (state) clearSnipes(guildId);
  await status(ctx, guildId);
}

export function registerSnipeFilter(): void {
  provideSnipeGate(async (guildId, channel) => {
    const held = await settingsFor(guildId, KIND);
    if (!held.enabled) return true;
    return held.exemptChannels.includes(channel);
  });

  register({
    name: "snipe",
    aliases: ["snipes", "sniping"],
    description: "Stop deleted messages being sniped",
    handler: main,
  });
}
