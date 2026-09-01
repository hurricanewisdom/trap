import { write, type Wrote } from "./discord.js";

export const KEYWORD = 1;

export const SPAM = 3;

export const MENTION_SPAM = 5;

export const MAX_KEYWORD_RULES = 6;

export const MAX_REGEX = 10;

export const MAX_KEYWORDS = 1000;

export const MAX_ALLOW = 100;

export const MAX_EXEMPT_ROLES = 20;

export const MAX_EXEMPT_CHANNELS = 50;

export interface RuleMetadata {
  keyword_filter?: string[];
  regex_patterns?: string[];
  allow_list?: string[];
  mention_total_limit?: number;
  mention_raid_protection_enabled?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: number;
  trigger_metadata: RuleMetadata;
  exempt_roles: string[];
  exempt_channels: string[];
  actions: { type: number; metadata?: Record<string, unknown> }[];
  creator_id?: string;
}

export interface RuleDraft {
  name?: string;
  enabled?: boolean;
  trigger_metadata?: RuleMetadata;
  exempt_roles?: string[];
  exempt_channels?: string[];
  actions?: { type: number; metadata?: Record<string, unknown> }[];
}

export function ruleName(kind: string): string {
  return `trap: ${kind}`;
}

export async function rules(guildId: string): Promise<Rule[]> {
  const got = await write<Rule[]>("GET", `/guilds/${guildId}/auto-moderation/rules`);
  return got.ok ? got.data : [];
}

export async function ruleFor(guildId: string, kind: string): Promise<Rule | null> {
  const wanted = ruleName(kind);
  return (await rules(guildId)).find((rule) => rule.name === wanted) ?? null;
}

export async function mentionRule(guildId: string): Promise<Rule | null> {
  return (await rules(guildId)).find((rule) => rule.trigger_type === MENTION_SPAM) ?? null;
}

export function blockAction(reason: string): { type: number; metadata: Record<string, unknown> } {
  return { type: 1, metadata: { custom_message: reason.slice(0, 150) } };
}

export async function createRule(
  guildId: string,
  kind: string,
  triggerType: number,
  draft: RuleDraft,
  reason: string,
): Promise<Wrote<Rule>> {
  return write<Rule>(
    "POST",
    `/guilds/${guildId}/auto-moderation/rules`,
    {
      name: ruleName(kind),
      event_type: 1,
      trigger_type: triggerType,
      trigger_metadata: draft.trigger_metadata ?? {},
      actions: draft.actions ?? [blockAction("Blocked by the server's filter.")],
      enabled: draft.enabled ?? true,
      exempt_roles: draft.exempt_roles ?? [],
      exempt_channels: draft.exempt_channels ?? [],
    },
    reason,
  );
}

export async function patchRule(
  guildId: string,
  ruleId: string,
  draft: RuleDraft,
  reason: string,
): Promise<Wrote<Rule>> {
  return write<Rule>(
    "PATCH",
    `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
    draft,
    reason,
  );
}

export async function deleteRule(
  guildId: string,
  ruleId: string,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>(
    "DELETE",
    `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
    undefined,
    reason,
  );
}

export async function keywordSlots(guildId: string): Promise<number> {
  const used = (await rules(guildId)).filter((rule) => rule.trigger_type === KEYWORD).length;
  return Math.max(0, MAX_KEYWORD_RULES - used);
}

export function explain(message: string): string {
  if (/MAX_RULES_OF_TYPE/i.test(message)) {
    return `Discord allows only ${MAX_KEYWORD_RULES} keyword rules per server and they are all in use. Free one in Server Settings, or remove another filter.`;
  }
  if (/REGEX_SYNTAX/i.test(message)) {
    return "Discord rejected that pattern. Its engine has no backreferences or lookaround.";
  }
  if (/MAX_LENGTH/i.test(message)) {
    return "That is more entries than Discord will take on one rule.";
  }
  if (/cannot be deleted from community servers/i.test(message)) {
    return "Community servers must keep a mention rule, so it can only be turned off, not removed.";
  }
  return `Discord said: ${message}`;
}
