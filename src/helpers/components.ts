/**
 * Components V2 primitives.
 *
 * discordeno v21 predates Components V2, so its `MessageComponentTypes` stops
 * at select menus and it has no types for Container/Section/Separator. The
 * REST layer posts the interaction body untransformed, so these
 * Discord-shaped (snake_case) objects go over the wire as-is.
 *
 * Values mirror the official reference:
 * https://discord.com/developers/docs/components/reference
 */

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
} as const;

export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
  Premium: 6,
} as const;

export const SeparatorSpacing = {
  Small: 1,
  Large: 2,
} as const;

/** Any message using V2 components must set this flag, and may not send `content` or `embeds`. */
export const IS_COMPONENTS_V2 = 1 << 15; // 32768

export interface UnfurledMedia {
  url: string;
}

export interface TextDisplay {
  type: typeof ComponentType.TextDisplay;
  content: string;
}

export interface Thumbnail {
  type: typeof ComponentType.Thumbnail;
  media: UnfurledMedia;
  description?: string;
  spoiler?: boolean;
}

export interface Button {
  type: typeof ComponentType.Button;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  label?: string;
  emoji?: { id?: string; name?: string; animated?: boolean };
  custom_id?: string;
  url?: string;
  sku_id?: string;
  disabled?: boolean;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { id?: string; name?: string; animated?: boolean };
  default?: boolean;
}

export interface SelectMenu {
  type:
    | typeof ComponentType.StringSelect
    | typeof ComponentType.UserSelect
    | typeof ComponentType.RoleSelect
    | typeof ComponentType.MentionableSelect
    | typeof ComponentType.ChannelSelect;
  custom_id: string;
  options?: SelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
  channel_types?: number[];
}

export interface ActionRow {
  type: typeof ComponentType.ActionRow;
  components: (Button | SelectMenu)[];
}

export interface Section {
  type: typeof ComponentType.Section;
  /** One to three text displays. */
  components: TextDisplay[];
  accessory: Thumbnail | Button;
}

export interface MediaGallery {
  type: typeof ComponentType.MediaGallery;
  /** One to ten items. */
  items: { media: UnfurledMedia; description?: string; spoiler?: boolean }[];
}

export interface FileComponent {
  type: typeof ComponentType.File;
  /** Only supports `attachment://<filename>` references. */
  file: UnfurledMedia;
  spoiler?: boolean;
}

export interface Separator {
  type: typeof ComponentType.Separator;
  divider?: boolean;
  spacing?: (typeof SeparatorSpacing)[keyof typeof SeparatorSpacing];
}

export type ContainerChild =
  | ActionRow
  | TextDisplay
  | Section
  | MediaGallery
  | Separator
  | FileComponent;

export interface Container {
  type: typeof ComponentType.Container;
  components: ContainerChild[];
  /** RGB accent stripe, 0x000000–0xFFFFFF. */
  accent_color?: number | null;
  spoiler?: boolean;
}

export type TopLevelComponent = Container | ContainerChild;

/* ------------------------------------------------------------------ */
/* Builders — thin, typed wrappers so call sites stay readable.        */
/* ------------------------------------------------------------------ */

export const text = (content: string): TextDisplay => ({
  type: ComponentType.TextDisplay,
  content,
});

export const separator = (
  divider = true,
  spacing: (typeof SeparatorSpacing)[keyof typeof SeparatorSpacing] = SeparatorSpacing.Small,
): Separator => ({ type: ComponentType.Separator, divider, spacing });

export const thumbnail = (url: string, description?: string, spoiler?: boolean): Thumbnail => ({
  type: ComponentType.Thumbnail,
  media: { url },
  description,
  spoiler,
});

export const section = (accessory: Thumbnail | Button, ...lines: string[]): Section => ({
  type: ComponentType.Section,
  components: lines.map(text),
  accessory,
});

export const gallery = (
  ...items: { url: string; description?: string; spoiler?: boolean }[]
): MediaGallery => ({
  type: ComponentType.MediaGallery,
  items: items.map(({ url, description, spoiler }) => ({
    media: { url },
    description,
    spoiler,
  })),
});

export const file = (filename: string, spoiler = false): FileComponent => ({
  type: ComponentType.File,
  file: { url: `attachment://${filename}` },
  spoiler,
});

export const row = (...components: (Button | SelectMenu)[]): ActionRow => ({
  type: ComponentType.ActionRow,
  components,
});

export const container = (
  accentColor: number | null,
  ...components: ContainerChild[]
): Container => ({
  type: ComponentType.Container,
  accent_color: accentColor,
  components,
});
