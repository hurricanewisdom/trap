import type { Cog } from "../../core/cog.js";
import { inCategory } from "../../core/prefix.js";
import { registerAfk } from "./afk.js";
import { registerAsk } from "./ask.js";
import { registerDiscogs } from "./discogs.js";
import { registerEmbeds } from "./embeds/index.js";
import { registerFun } from "./fun.js";
import { registerListen } from "./listen.js";
import { registerMedia } from "./media.js";
import { registerNames } from "./names.js";
import { registerRun } from "./run.js";
import { registerServer } from "./server.js";
import { registerSports } from "./sports.js";
import { registerText } from "./text.js";
import { registerTopCommands } from "./topcommands.js";
import { registerWikihow } from "./wikihow.js";

export const miscCog: Cog = {
  name: "miscellaneous",
  label: "Miscellaneous",
  description: "Everything that did not belong anywhere else",
  setup() {
    inCategory("embeds", registerEmbeds);
    inCategory("games", registerFun);
    inCategory("textplay", registerText);
    inCategory("scores", registerSports);
    inCategory("away", registerAfk);
    inCategory("records", () => {
      registerNames();
      registerTopCommands();
    });
    inCategory("elsewhere", () => {
      registerDiscogs();
      registerWikihow();
      registerMedia();
      registerListen();
    });
    inCategory("sandbox", () => {
      registerRun();
      registerAsk();
    });
    inCategory("tools", registerServer);
  },
};
