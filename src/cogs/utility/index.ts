import type { Cog } from "../../core/cog.js";
import { inCategory } from "../../core/prefix.js";
import { registerSnipe } from "./snipe.js";
import { registerPins } from "./pins/index.js";

export const utilityCog: Cog = {
  name: "utility",
  label: "Utility",
  description: "Server tools",
  setup() {
    inCategory("snipe", registerSnipe);
    inCategory("pins", registerPins);
  },
};
