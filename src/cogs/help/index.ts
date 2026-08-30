/**
 * The help cog.
 *
 * Loaded last, because the menu is generated from whatever is in the command
 * registry at setup time.
 */

import type { Cog } from "../../core/cog.js";
import { lookup } from "../../core/prefix.js";
import { flatProvider, provideSlash } from "../../core/slash.js";
import { onComponent, onModal } from "../../core/hooks.js";
import { handleFindModal, handleHelpInteraction, registerHelp, setHelpPrefix } from "./commands.js";

export const helpCog: Cog = {
  name: "help",
  description: "The command browser",
  setup(ctx) {
    setHelpPrefix(ctx.prefix);
    registerHelp();

    onComponent("help|", async (interaction) => {
      const outcome = await handleHelpInteraction(interaction);
      // The close button asks for its own message to be removed.
      if (outcome) await ctx.messages.delete(String(interaction.channelId), outcome.deleteMessageId);
    });

    onModal("helpfind:", (interaction) => handleFindModal(interaction));

    const help = lookup("help");
    if (help) {
      provideSlash(
        flatProvider([
          {
            name: "help",
            command: help,
            options: [
              { kind: "text", name: "query", description: "A command, group or category to look up" },
            ],
          },
        ]),
      );
    }
  },
};
