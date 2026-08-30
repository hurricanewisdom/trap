import type { Cog } from "../../core/cog.js";
import { lookup } from "../../core/prefix.js";
import { flatProvider, provideAutocomplete, provideSlash } from "../../core/slash.js";
import { onComponent, onModal } from "../../core/hooks.js";
import {
  handleFindModal,
  handleHelpInteraction,
  handleJumpModal,
  helpChoices,
  registerHelp,
} from "./commands.js";
import { FIND_MODAL_PREFIX, JUMP_PREFIX } from "./render.js";

export const helpCog: Cog = {
  name: "help",
  label: "Help",
  description: "The command browser",
  setup(ctx) {
    registerHelp();

    onComponent("help|", async (interaction) => {
      const outcome = await handleHelpInteraction(interaction);
      if (outcome) await ctx.messages.delete(String(interaction.channelId), outcome.deleteMessageId);
    });

    onModal(FIND_MODAL_PREFIX, (interaction) => handleFindModal(interaction));
    onModal(JUMP_PREFIX, (interaction) => handleJumpModal(interaction));

    const help = lookup("help");
    if (!help) return;

    provideSlash(
      flatProvider([
        {
          name: "help",
          command: help,
          options: [
            {
              kind: "text",
              name: "query",
              description: "Search every command by name, alias or description",
              autocomplete: true,
            },
          ],
        },
      ]),
    );

    provideAutocomplete("help", (query) => helpChoices(query));
  },
};
