import type { Cog } from "../../core/cog.js";
import { unbanMember } from "../../core/discord.js";
import { inCategory } from "../../core/prefix.js";
import { record } from "./cases.js";
import { registerPunish } from "./punish.js";
import { onDue, startSchedule } from "./schedule.js";

export const moderationCog: Cog = {
  name: "moderation",
  label: "Moderation",
  description: "Punishments, case logs and channel control",
  setup() {
    // Anything with a duration is written to the database and picked up here,
    // rather than held in a timer that a restart would forget.
    onDue("unban", async (due) => {
      const done = await unbanMember(due.guildId, due.targetId, "temporary ban expired");
      // Recorded either way: a ban somebody lifted by hand is not a failure, and
      // the log should say the clock ran out rather than stay silent.
      if (done.ok) {
        await record(due.guildId, "unban", due.targetId, "0", "Temporary ban expired");
      }
    });

    startSchedule();
    inCategory("punish", registerPunish);
  },
};
