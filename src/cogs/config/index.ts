import type { Cog } from "../../core/cog.js";
import { inCategory } from "../../core/prefix.js";
import { registerPrefix } from "./prefix.js";
import { registerBoosterRole } from "./boosterrole/index.js";
import { registerBoostMessages, registerGoodbye, registerWelcome } from "./greetings/index.js";
import { registerAlias } from "./alias/index.js";
import { registerSticky } from "./sticky/index.js";
import { registerGallery } from "./gallery/index.js";
import { registerFilter } from "./filter/index.js";
import { registerAutoresponder } from "./autoresponder/index.js";
import { registerPagination } from "./pagination/index.js";
import { registerAvailability } from "./availability/index.js";

export const configCog: Cog = {
  name: "configuration",
  label: "Configuration",
  description: "Server settings",
  setup() {
    inCategory("prefix", registerPrefix);
    inCategory("booster", registerBoosterRole);
    inCategory("welcome", registerWelcome);
    inCategory("goodbye", registerGoodbye);
    inCategory("boost", registerBoostMessages);
    inCategory("alias", registerAlias);
    inCategory("sticky", registerSticky);
    inCategory("gallery", registerGallery);
    inCategory("filter", registerFilter);
    inCategory("autoresponder", registerAutoresponder);
    inCategory("pagination", registerPagination);
    inCategory("availability", registerAvailability);
  },
};
