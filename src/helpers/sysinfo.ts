import { readFileSync, readdirSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export interface Meter {
  used: number;
  total: number;
  ratio: number;
}

export interface SystemInfo {
  cpu: Meter;
  memory: Meter;
  disk: Meter | null;
  hostUptime: number;
  processUptime: number;
  pid: number;
  rss: number;
  heap: number;
  cores: number;
}

async function cpuBusy(windowMs = 120): Promise<number> {
  const sample = () => {
    let idle = 0;
    let total = 0;
    for (const core of os.cpus()) {
      for (const [kind, ms] of Object.entries(core.times)) {
        total += ms;
        if (kind === "idle") idle += ms;
      }
    }
    return { idle, total };
  };

  const first = sample();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const second = sample();

  const totalDelta = second.total - first.total;
  if (totalDelta <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (second.idle - first.idle) / totalDelta));
}

export async function systemInfo(): Promise<SystemInfo> {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const memoryUsage = process.memoryUsage();

  let disk: Meter | null = null;
  try {
    const stats = await statfs("/");

    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (total > 0) disk = { used: total - free, total, ratio: (total - free) / total };
  } catch {}

  const busy = await cpuBusy();

  return {
    cpu: { used: busy * 100, total: 100, ratio: busy },
    memory: { used: usedMemory, total: totalMemory, ratio: usedMemory / totalMemory },
    disk,
    hostUptime: os.uptime(),
    processUptime: process.uptime(),
    pid: process.pid,
    rss: memoryUsage.rss,
    heap: memoryUsage.heapUsed,
    cores: os.cpus().length,
  };
}

export interface CodeInfo {
  files: number;
  lines: number;
}

let code: CodeInfo | null = null;

export function codeInfo(root = "src"): CodeInfo {
  if (code) return code;

  let files = 0;
  let lines = 0;

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) {
        files += 1;
        try {
          lines += readFileSync(full, "utf8").split("\n").length;
        } catch {}
      }
    }
  };

  walk(root);
  code = { files, lines };
  return code;
}

export function packageVersion(name: string): string | null {
  try {
    const manifest = readFileSync(path.join("node_modules", name, "package.json"), "utf8");
    return (JSON.parse(manifest) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

export function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}G`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)}M`;
  if (value >= 1024) return `${Math.round(value / 1024)}K`;
  return `${value}B`;
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && !h ? `${s}s` : ""].filter(Boolean);
  return parts.slice(0, 2).join(" ") || "0s";
}

export function meterBar(ratio: number, width = 18): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
