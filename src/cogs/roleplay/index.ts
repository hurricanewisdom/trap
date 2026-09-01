import type { Cog } from "../../core/cog.js";
import { registerActions } from "./actions.js";
import { registerConfig } from "./config.js";

export const roleplayCog: Cog = {
  name: "roleplay",
  label: "Roleplay",
  description: "Reaction commands, off until a server turns them on",
  setup() {
    registerConfig();
    registerActions();
  },
};
