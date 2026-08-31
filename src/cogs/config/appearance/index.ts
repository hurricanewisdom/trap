import { editGuild, getGuild } from "../../../core/discord.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { USER_AGENT } from "../../../helpers/http.js";
import { checkImageUrl } from "../../../helpers/imageurl.js";

const HEADING = "Server look";

const MAX_BYTES = 8 * 1024 * 1024;

const FETCH_MS = 12_000;

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

interface Fetched {
  dataUri: string;
  bytes: number;
  animated: boolean;
}

async function grab(href: string): Promise<Fetched | string> {
  const stop = AbortSignal.timeout(FETCH_MS);

  let res: Response;
  try {
    res = await fetch(href, { headers: { "User-Agent": USER_AGENT }, signal: stop, redirect: "follow" });
  } catch {
    return "I could not reach that link.";
  }
  if (!res.ok) return `That link answered ${res.status}.`;

  const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!TYPES[type]) return "That is not a PNG, JPEG, GIF or WebP.";

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return `That image is larger than ${MAX_BYTES / 1024 / 1024}MB.`;

  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength === 0) return "That link gave me an empty file.";
  if (body.byteLength > MAX_BYTES) return `That image is larger than ${MAX_BYTES / 1024 / 1024}MB.`;

  return {
    dataUri: `data:${type};base64,${Buffer.from(body).toString("base64")}`,
    bytes: body.byteLength,
    animated: type === "image/gif",
  };
}

interface Look {
  command: string;
  field: "icon" | "banner" | "splash";
  label: string;
  needs?: { feature: string; says: string };
}

const LOOKS: Look[] = [
  { command: "seticon", field: "icon", label: "icon" },
  {
    command: "setbanner",
    field: "banner",
    label: "banner",
    needs: { feature: "BANNER", says: "A banner needs boost level 2, or the BANNER feature." },
  },
  {
    command: "setsplashbackground",
    field: "splash",
    label: "splash background",
    needs: {
      feature: "INVITE_SPLASH",
      says: "A splash background needs boost level 1, or the INVITE_SPLASH feature.",
    },
  },
];

function build(look: Look): void {
  const handler = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `change the server ${look.label}`);
    if (!guildId) return;

    const typed = ctx.argument.trim();
    if (!typed) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          `Give me a link to the new ${look.label}.`,
          "",
          `-# \`${look.command} <url>\` · PNG, JPEG, GIF or WebP`,
        ].join("\n"),
      );
      return;
    }

    const checked = checkImageUrl(typed);
    if (!checked.ok) {
      await card(ctx, [`### ${HEADING}`, checked.reason].join("\n"));
      return;
    }

    if (look.needs) {
      const guild = await getGuild(guildId);
      const features = (guild as unknown as { features?: string[] })?.features ?? [];
      if (!features.includes(look.needs.feature)) {
        await card(
          ctx,
          [`### ${HEADING}`, look.needs.says, "", "-# Discord decides this, not me."].join("\n"),
        );
        return;
      }
    }

    const got = await grab(checked.href);
    if (typeof got === "string") {
      await card(ctx, [`### ${HEADING}`, got].join("\n"));
      return;
    }
    if (got.animated && look.field !== "banner") {
      await card(
        ctx,
        [`### ${HEADING}`, `Discord does not take an animated ${look.label}.`].join("\n"),
      );
      return;
    }

    const saved = await editGuild(
      guildId,
      { [look.field]: got.dataUri },
      `${look.label} set by ${ctx.authorId}`,
    );

    await card(
      ctx,
      saved.ok
        ? [
            `### ${HEADING}`,
            `The server ${look.label} is set.`,
            `-# ${Math.round(got.bytes / 1024)}KB from ${new URL(checked.href).host}`,
          ].join("\n")
        : [
            `### ${HEADING}`,
            `Discord would not take that ${look.label}.`,
            `-# ${saved.message.slice(0, 200)}`,
          ].join("\n"),
    );
  };

  register({
    name: look.command,
    description: `Set the server ${look.label}`,
    handler,
  });
}

export function registerAppearance(): void {
  for (const look of LOOKS) build(look);
}
