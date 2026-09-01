import { api } from "../../core/discord.js";
import { paginate } from "../../core/pager.js";
import { requireManageGuild } from "../../core/permissions.js";
import { lookupPath, register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, madeAt, stamp, words } from "./shared.js";
import { pagesOf } from "./pages.js";

async function timediff(ctx: PrefixContext): Promise<void> {
  const [first, second] = words(ctx.argument);
  if (!first || !second || !/^\d{15,25}$/.test(first) || !/^\d{15,25}$/.test(second)) {
    await card(ctx, ["Two Discord ids, please.", "", "-# `timediff <id> <id>`"]);
    return;
  }

  const a = madeAt(first);
  const b = madeAt(second);
  const apart = Math.abs(a - b);

  const days = Math.floor(apart / 86_400_000);
  const hours = Math.floor((apart % 86_400_000) / 3_600_000);
  const minutes = Math.floor((apart % 3_600_000) / 60_000);
  const seconds = Math.floor((apart % 60_000) / 1000);

  const said = [
    days ? `${days} day${days === 1 ? "" : "s"}` : null,
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : null,
    minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : null,
    seconds || apart < 1000 ? `${seconds} second${seconds === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  await card(ctx, [
    `### ${said}`,
    `-# ${stamp(Math.min(a, b), "f")} → ${stamp(Math.max(a, b), "f")}`,
    `-# ${apart.toLocaleString()}ms apart`,
  ]);
}

interface Invite {
  code: string;
  uses?: number;
  max_uses?: number;
  max_age?: number;
  temporary?: boolean;
  created_at?: string;
  expires_at?: string | null;
  inviter?: { id?: string; username?: string };
  channel?: { id?: string; name?: string };
}

async function invites(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the server's invites");
  if (!guildId) return;

  const held = await api<Invite[]>(`/guilds/${guildId}/invites`);
  if (!held) {
    await card(ctx, ["Those could not be read.", "", "-# The bot needs Manage Server here too."]);
    return;
  }

  const sorted = [...held].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0));
  const lines = sorted.map((one) => {
    const cap = one.max_uses ? `/${one.max_uses}` : "";
    return (
      `[\`${one.code}\`](https://discord.gg/${one.code}) — **${one.uses ?? 0}${cap}** uses` +
      (one.channel?.id ? ` · <#${one.channel.id}>` : "") +
      (one.inviter?.id ? ` · <@${one.inviter.id}>` : " · vanity") +
      (one.expires_at ? ` · expires ${stamp(one.expires_at)}` : " · never expires")
    );
  });

  const total = sorted.reduce((sum, one) => sum + (one.uses ?? 0), 0);
  await paginate(
    ctx,
    pagesOf(`${held.length} invite${held.length === 1 ? "" : "s"}`, lines, 8, `${total} uses between them`),
    null,
  );
}

// `emoji add` already downloads an emote and adds it, with the permission check
// and the naming rules that go with it. Registering a second implementation
// would mean two things to keep in step, so this hands over to that one.
async function addemote(ctx: PrefixContext): Promise<void> {
  const held = lookupPath("emoji add");
  if (!held) {
    await card(ctx, ["That is not available."]);
    return;
  }
  await held.handler(ctx);
}

export function registerServer(): void {
  register({ name: "timediff", description: "Find the time between any two Discord ids", handler: timediff });
  register({ name: "invites", description: "View all active invites", handler: invites });
  register({ name: "addemote", description: "Downloads an emote and adds it to the server", handler: addemote });
}
