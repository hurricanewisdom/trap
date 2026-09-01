import { requireAdministrator } from "../../core/permissions.js";
import { container, text, IS_COMPONENTS_V2 } from "../../helpers/components.js";
import { inCategory, register, type PrefixContext } from "../../core/prefix.js";
import { ACTION_COUNT } from "./actions.js";
import { enabled, setEnabled } from "./store.js";

const ON = new Set(["enable", "enabled", "on", "yes", "true"]);

const OFF = new Set(["disable", "disabled", "off", "no", "false"]);

function card(body: string[]) {
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [container(null, text(body.join("\n")))],
  };
}

async function roleplay(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "change the roleplay setting");
  if (!guildId) return;

  const said = ctx.argument.trim().toLowerCase();

  // No option is a question, not a mistake: it says where the server stands and
  // what to type, rather than refusing.
  if (!said) {
    const on = await enabled(guildId);
    await ctx.reply(
      card([
        `### Roleplay is ${on ? "on" : "off"}`,
        `-# ${ACTION_COUNT} commands, ${on ? "usable by everybody here" : "off by default until an administrator turns them on"}.`,
        "",
        `-# \`roleplay ${on ? "disable" : "enable"}\``,
      ]),
    );
    return;
  }

  if (!ON.has(said) && !OFF.has(said)) {
    await ctx.reply(card(["On or off?", "", "-# `roleplay enable` · `roleplay disable`"]));
    return;
  }

  const wanted = ON.has(said);
  const already = await enabled(guildId);
  if (already === wanted) {
    await ctx.reply(card([`Roleplay is already ${wanted ? "on" : "off"}.`]));
    return;
  }

  await setEnabled(guildId, wanted);
  await ctx.reply(
    card(
      wanted
        ? [
            "### Roleplay is on",
            `-# All ${ACTION_COUNT} of them, for everybody in this server.`,
          ]
        : ["### Roleplay is off", "-# The commands stay registered, they just decline."],
    ),
  );
}

export function registerConfig(): void {
  inCategory("roleplay", () => {
    register({
      name: "roleplay",
      description: "Turn the roleplay commands on or off",
      handler: roleplay,
    });
  });
}
