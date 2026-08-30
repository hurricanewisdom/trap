import os from "node:os";
import process from "node:process";
import { IS_COMPONENTS_V2, container, separator, text } from "../../helpers/components.js";
import { allCommands, register, type PrefixContext } from "../../core/prefix.js";
import { loadedCogs } from "../../core/cog.js";
import {
  bytes,
  codeInfo,
  duration,
  meterBar,
  packageVersion,
  systemInfo,
  type SystemInfo,
} from "../../helpers/sysinfo.js";

const ACCENT: number | null = null;

export interface GeneralEnv {
  botVersion: string;
  libVersion: string;
  latency: () => string;
  shardCount: () => number;
  prefix: string;
}

function pair(label: string, value: string, width = 9): string {
  return `${label.padEnd(width)}${value}`;
}

function row(left: string, right: string, gap = 26): string {
  return right ? left.padEnd(gap) + right : left;
}

const RULE = "─".repeat(46);

const FENCE = "``" + "`";

function panel(
  system: SystemInfo,
  source: { files: number; lines: number },
  commandCount: number,
  deps: [string, string][],
  env: GeneralEnv,
): string {
  const lines: string[] = [];

  lines.push(pair("cpu", `${system.cpu.used.toFixed(0)}% of ${system.cores} cores`.padEnd(17) + meterBar(system.cpu.ratio)));
  lines.push(
    pair(
      "memory",
      `${bytes(system.memory.used)} / ${bytes(system.memory.total)}`.padEnd(17) +
        meterBar(system.memory.ratio),
    ),
  );
  if (system.disk) {
    lines.push(
      pair(
        "disk",
        `${bytes(system.disk.used)} / ${bytes(system.disk.total)}`.padEnd(17) +
          meterBar(system.disk.ratio),
      ),
    );
  }

  lines.push(RULE);
  lines.push(row(pair("ping", env.latency()), pair("pid", String(system.pid))));
  lines.push(row(pair("uptime", duration(system.processUptime)), pair("host up", duration(system.hostUptime))));
  lines.push(row(pair("rss", bytes(system.rss)), pair("heap", bytes(system.heap))));
  lines.push(row(pair("shards", String(env.shardCount())), pair("node", process.version)));

  lines.push(RULE);
  lines.push(row(pair("files", String(source.files)), pair("commands", String(commandCount))));
  lines.push(
    row(pair("lines", source.lines.toLocaleString("en-US")), pair("platform", `${os.type()} ${os.arch()}`)),
  );

  if (deps.length > 0) {
    lines.push(RULE);
    for (let i = 0; i < deps.length; i += 2) {
      const left = deps[i];
      const right = deps[i + 1];
      lines.push(
        row(
          `${left?.[0] ?? ""} ${left?.[1] ?? ""}`.trim(),
          right ? `${right[0]} ${right[1]}` : "",
        ),
      );
    }
  }

  return [FENCE, ...lines, FENCE].join("\n");
}

export function registerGeneral(env: GeneralEnv): void {
  register({
    name: "ping",
    description: "Gateway latency",
    handler: async (ctx: PrefixContext) => {
      await ctx.reply({
        flags: IS_COMPONENTS_V2,
        components: [container(ACCENT, text(env.latency()))],
      });
    },
  });

  register({
    name: "botinfo",
    aliases: ["about", "bi"],
    description: "Runtime, host and codebase statistics",
    handler: async (ctx: PrefixContext) => {
      const [system, commands] = [await systemInfo(), allCommands()];
      const source = codeInfo();

      const deps = [
        ["discordeno", env.libVersion],
        ["postgres", packageVersion("postgres")],
        ["ioredis", packageVersion("ioredis")],
        ["sharp", packageVersion("sharp")],
      ].filter((row): row is [string, string] => Boolean(row[1]));

      await ctx.reply({
        flags: IS_COMPONENTS_V2,
        components: [
          container(
            ACCENT,
            text(
              `### Trap\nv${env.botVersion} · ${commands.length} commands · ${loadedCogs().length} cogs`,
            ),
            separator(true),
            text(panel(system, source, commands.length, deps, env)),
          ),
        ],
      });
    },
  });
}
