/** Typed access to configuration, with loud failure for anything required. */

import process from "node:process";

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env`);
  }
  return value;
}

export function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True when every named variable has a value. */
export function configured(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]));
}
