import type { Cog } from "../../core/cog.js";
import { takeRole, unbanMember } from "../../core/discord.js";
import { onMemberJoin, onMemberUpdate } from "../../core/hooks.js";
import { inCategory } from "../../core/prefix.js";
import { record } from "./cases.js";
import { registerHistory } from "./history.js";
import { registerJail, releaseFrom } from "./jail.js";
import { registerChannels } from "./channels.js";
import { dueNukes, registerExtras } from "./extras.js";
import { registerPeople, reapplyNick, reapplySticky, sendReminder } from "./people.js";
import { registerThreads, unarchiveWatched } from "./threads.js";
import { registerPunish } from "./punish.js";
import { registerPurge } from "./purge.js";
import { registerRoles } from "./roles.js";
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

    onDue("unjail", async (due) => {
      await releaseFrom(due.guildId, due.targetId);
      await record(due.guildId, "unjail", due.targetId, "0", "Jail time served");
    });

    onDue("role", async (due) => {
      if (due.extra) await takeRole(due.guildId, due.targetId, due.extra, "temporary role expired");
    });

    onDue("unmute", async (due) => {
      if (!due.extra) return;
      await takeRole(due.guildId, due.targetId, due.extra, "mute expired");
      await record(due.guildId, "unmute", due.targetId, "0", "Mute expired");
    });

    onDue("remind", async (due) => {
      if (due.extra) await sendReminder(due.targetId, due.extra);
    });

    // A forced nickname changing back, and a watched thread being archived, are
    // both things nobody tells the bot about, so they are swept on a clock.
    onMemberJoin(async (event) => {
      await reapplySticky(event.guildId, event.userId);
      await reapplyNick(event.guildId, event.userId);
    });

    onMemberUpdate(async (event) => {
      await reapplyNick(event.guildId, event.userId);
    });

    setInterval(() => void unarchiveWatched().catch(() => {}), 300_000).unref?.();
    setInterval(() => void dueNukes().catch(() => {}), 300_000).unref?.();

    startSchedule();
    inCategory("punish", registerPunish);
    inCategory("history", registerHistory);
    inCategory("jail", registerJail);
    inCategory("purge", registerPurge);
    inCategory("roles", registerRoles);
    inCategory("channels", registerChannels);
    inCategory("threads", registerThreads);
    inCategory("people", registerPeople);
    inCategory("extras", registerExtras);
  },
};
