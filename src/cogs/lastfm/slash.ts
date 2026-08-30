/**
 * How the Last.fm commands are laid out as `/<parent> <group> <name>`.
 *
 * Data only. Every command in the cog appears here exactly once, and a check
 * at startup fails the boot if the two ever drift — a command missing from
 * this table would silently become unreachable, which is the whole failure
 * mode this file exists to prevent.
 *
 * Why grouped: Discord allows 25 subcommands under a command, and there are
 * 115 of these; groups raise the ceiling to 25 x 25. Why *two* parents: see
 * `Parent` below. Now playing is lifted out entirely, as `/fm`.
 *
 * The options each command takes were read off its handler: `user` where it
 * calls `resolveTarget`, `period` where it calls `extractPeriod`, and a text
 * field where it reads `ctx.argument` for an operand.
 */

import type { SlashOption } from "../../core/slash.js";

/**
 * The shared field hints are deliberately terse.
 *
 * Each is repeated across dozens of subcommands and every copy counts against
 * Discord's 8000-character budget per command — the `user` hint alone was 40
 * characters times 69 uses. The field's own name carries the meaning, so the
 * hint only has to say what the default is.
 */
const USER: SlashOption = {
  kind: "user",
  name: "user",
  description: "Defaults to you",
};

const PERIOD: SlashOption = {
  kind: "period",
  name: "period",
  description: "Defaults to your saved range",
};

/** A free-text operand, described per command so the field explains itself. */
const text = (description: string): SlashOption => ({ kind: "text", name: "query", description });

const ARTIST = text("Artist. Defaults to now playing");
const ALBUM = text("`artist - album`. Defaults to now playing");
const TRACK = text("`artist - track`. Defaults to now playing");
const TAG = text("A tag, such as `shoegaze`");
const SEARCH = text("What to search for");

/**
 * Which top-level command a group hangs off.
 *
 * There are two of them because Discord caps a single command at 8000
 * characters across its whole tree, and 115 subcommands with real
 * descriptions and input fields come to 13,248. Splitting the tree gives each
 * half its own budget, which is what lets every command keep its full
 * description, its period dropdown, and a genuine clickable mention.
 */
export type Parent = "lastfm" | "lfmusic";

export interface GroupSpec {
  parent: Parent;
  name: string;
  description: string;
  /**
   * The command that sits directly under the parent instead of inside this
   * group, so an area's headline reads as `/lfmusic crowns` rather than
   * `/lfmusic crowns crowns`.
   *
   * It must differ from the group's name: both end up in the parent's single
   * option list, and Discord rejects two options sharing a name.
   */
  promote?: string;
  /** Registered command name -> its typed fields. */
  commands: Record<string, SlashOption[]>;
}

/**
 * The groups, in the order they appear in Discord's picker.
 *
 * Sized deliberately: no group is near the 25 limit, so a new command can be
 * added to the obvious place without reshuffling.
 */
export const GROUPS: GroupSpec[] = [
  {
    parent: "lastfm",
    name: "account",
    description: "Linking and unlinking your Last.fm account",
    commands: {
      lastfm: [text("`link`, `unlink`, or leave empty for your account")],
    },
  },
  {
    parent: "lastfm",
    name: "charts",
    description: "Your most played artists, albums and tracks",
    commands: {
      topartists: [USER, PERIOD],
      topalbums: [USER, PERIOD],
      toptracks: [USER, PERIOD],
    },
  },
  {
    parent: "lastfm",
    name: "counts",
    description: "Play counts for one artist, album or track",
    promote: "plays",
    commands: {
      plays: [USER, ARTIST],
      playsalbum: [USER, ALBUM],
      playstrack: [USER, TRACK],
      playsall: [USER],
      overview: [USER, ARTIST],
      toptenalbums: [USER, ARTIST],
      toptentracks: [USER, ARTIST],
    },
  },
  {
    parent: "lastfm",
    name: "profile",
    description: "Scrobble totals, streaks and history",
    commands: {
      whois: [USER],
      count: [USER, PERIOD],
      recent: [USER],
      recentfor: [USER, text("How far back, such as `3 days`")],
      favorites: [USER],
      streak: [USER],
      score: [USER],
      milestone: [USER, text("Which scrobble number to look up")],
    },
  },
  {
    parent: "lastfm",
    name: "insights",
    description: "Patterns in when and how you listen",
    commands: {
      clock: [USER],
      weekday: [USER],
      nightowl: [USER],
      sessions: [USER],
      binge: [USER],
      gaps: [USER],
      firstscrobble: [USER, ARTIST],
      onthisday: [USER],
      pace: [USER],
      listeningtime: [USER],
    },
  },
  {
    parent: "lastfm",
    name: "personal",
    description: "Your own statistics and preferences",
    commands: {
      whoami: [USER],
      stats: [USER, PERIOD],
      variety: [USER, PERIOD],
      obscurity: [USER],
      share: [USER],
      chartsize: [text("Rows per page, such as `10`")],
      defaultperiod: [PERIOD],
    },
  },
  {
    parent: "lastfm",
    name: "weekly",
    description: "Week by week charts",
    commands: {
      weeklyartists: [USER],
      weeklyalbums: [USER],
      weeklytracks: [USER],
      weeks: [USER],
    },
  },
  {
    parent: "lfmusic",
    name: "info",
    description: "What Last.fm knows about an artist, album or track",
    commands: {
      artistinfo: [USER, ARTIST],
      albuminfo: [USER, ALBUM],
      trackinfo: [USER, TRACK],
      bio: [USER, ARTIST],
      cover: [USER, ALBUM],
      artistalbums: [USER, ARTIST],
      artisttracks: [USER, ARTIST],
      artisttagged: [USER, TAG],
    },
  },
  {
    parent: "lfmusic",
    name: "discovery",
    description: "Finding music you have not heard",
    promote: "discover",
    commands: {
      similar: [text("Artist to find neighbours of")],
      similartracks: [TRACK],
      tags: [ARTIST],
      genre: [TAG],
      genretracks: [TAG],
      trending: [text("Country name, or leave empty for worldwide")],
      hot: [text("Country name, or leave empty for worldwide")],
      discover: [USER],
      roulette: [USER],
      randomartist: [USER],
    },
  },
  {
    parent: "lfmusic",
    name: "search",
    description: "Searching the Last.fm catalogue",
    commands: {
      searchartist: [SEARCH],
      searchalbum: [SEARCH],
      searchtrack: [SEARCH],
      correct: [text("An artist, or `artist - track`")],
    },
  },
  {
    parent: "lfmusic",
    name: "tags",
    description: "How the crowd tags music",
    commands: {
      taginfo: [TAG],
      toptags: [],
      trendingtags: [],
      genrealbums: [TAG],
      albumtags: [USER, ALBUM],
      tracktags: [USER, TRACK],
    },
  },
  {
    parent: "lfmusic",
    name: "tagging",
    description: "Tags on your own account",
    promote: "mytags",
    commands: {
      tagartist: [text("`Artist | tag, tag`")],
      tagalbum: [text("`Artist - Album | tag, tag`")],
      tagtrack: [text("`Artist - Track | tag, tag`")],
      untag: [text("`Artist | tag`")],
      untagalbum: [text("`Artist - Album | tag`")],
      untagtrack: [text("`Artist - Track | tag`")],
      mytags: [USER],
      taggedwith: [USER, text("A tag of yours, plus `artists`, `albums` or `tracks`")],
      mytagsfor: [USER, ARTIST],
    },
  },
  {
    parent: "lfmusic",
    name: "listeners",
    description: "Who else here listens to something",
    promote: "whoknows",
    commands: {
      whoknows: [USER, ARTIST],
      wkalbum: [USER, ALBUM],
      wktrack: [USER, TRACK],
      globalwhoknows: [USER, ARTIST],
      globalwkalbum: [USER, ALBUM],
      globalwktrack: [USER, TRACK],
    },
  },
  {
    parent: "lfmusic",
    name: "crowns",
    description: "Who holds each artist in this server",
    promote: "crowns",
    commands: {
      // The only entry, so it is promoted and this group disappears.
      crowns: [USER],
    },
  },
  {
    parent: "lfmusic",
    name: "server",
    description: "Leaderboards and crowns across this server",
    commands: {
      mostcrowns: [],
      playing: [],
      hide: [text("`add`, `remove` or `list`")],
      leaderboard: [],
      scoreboard: [],
      globalboard: [],
      serverartists: [],
      serverobscurity: [],
      common: [USER],
      unique: [USER],
    },
  },
  {
    parent: "lfmusic",
    name: "compare",
    description: "Two libraries side by side",
    commands: {
      taste: [USER, PERIOD],
      recommendation: [USER, ARTIST],
    },
  },
  {
    parent: "lfmusic",
    name: "social",
    description: "The people you follow on Last.fm",
    promote: "friends",
    commands: {
      friends: [USER],
      friendsplaying: [USER],
      library: [USER, text("Which page of the library")],
    },
  },
  {
    parent: "lastfm",
    name: "art",
    description: "Cover art and image grids",
    commands: {
      collage: [USER, PERIOD, text("Grid and mode, such as `4x4 tracks nocaption`")],
      lfurl: [text("`set <url>`, `list`, `clear`")],
      vote: [text("Which submission to vote for")],
    },
  },
  {
    parent: "lfmusic",
    name: "apple",
    description: "iTunes search and audio previews",
    promote: "itunes",
    commands: {
      itunes: [SEARCH],
      itunesalbum: [SEARCH],
      preview: [USER, text("Track to preview. Defaults to what you are playing")],
    },
  },
  {
    parent: "lastfm",
    name: "scrobbling",
    description: "Writing to your Last.fm account",
    promote: "scrobble",
    commands: {
      love: [text("`artist - track`. Defaults to now playing")],
      unlove: [text("`artist - track`. Defaults to now playing")],
      scrobble: [text("`artist - track`")],
      setplaying: [text("`artist - track`")],
    },
  },
  {
    parent: "lastfm",
    name: "customize",
    description: "How your cards look and behave",
    commands: {
      lfmode: [text("Which layout to use")],
      lfcolor: [text("A hex colour, such as `#1db954`")],
      react: [text("`on`, `off`, or two emoji")],
      customreactions: [text("The emoji to use")],
      card: [text("`help`, `set <template>`, `show`, `check`, `example`, `reset`")],
      customcommand: [text("`set <word> <command>`, `remove <word>`, `list`")],
    },
  },
];

/**
 * Now playing keeps its own top-level command; it is the one people run
 * constantly.
 *
 * `custom` is how personal aliases survived the move to slash. A custom
 * command was always a shorthand for one member's now playing, so it belongs
 * here as a field rather than as a command of its own — `/fm custom:dylan` is
 * about as short as the old `,dylan` was. The field is autocompleted from the
 * words claimed in that server.
 */
export const TOP_LEVEL = {
  name: "fm",
  command: "nowplaying",
  description: "Show the current or most recent scrobble",
  options: [
    USER,
    {
      kind: "text",
      name: "custom",
      description: "A custom command word claimed in this server",
    },
  ] as SlashOption[],
};

/** The field on `/fm` that carries a custom command word. */
export const CUSTOM_OPTION = "custom";
