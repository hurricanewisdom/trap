/**
 * The Last.fm cog.
 *
 * Everything Last.fm lives under this folder:
 *   api.ts        the Last.fm HTTP client and response types
 *   store.ts      account links, in Postgres with a Redis read path
 *   settings.ts   per-user and per-guild preferences
 *   shared.ts     helpers every command here uses (targets, periods, cards)
 *   guard.ts      the error wrapper every handler is wrapped in
 *   hooks.ts      reaction votes and user-defined command words
 *   listening.ts  publishes "what is playing" for other cogs to read
 *   web.ts        the OAuth callback route
 *   slash.ts      how the commands are laid out as /lastfm <group> <name>
 *   slashsetup.ts builds that tree and checks it against the registry
 *   session.ts    the caller's own credentials, for the commands that write
 *   commands/     one file per group of commands
 */

import type { Cog } from "../../core/cog.js";
import { registerAccount } from "./commands/account.js";
import { registerAlbumArt } from "./commands/albumart.js";
import { registerBoard } from "./commands/board.js";
import { registerCharts } from "./commands/charts.js";
import { registerCompare } from "./commands/compare.js";
import { registerCrowns } from "./commands/crowns.js";
import { registerCustomCommands } from "./commands/customcommand.js";
import { registerNowPlaying } from "./commands/nowplaying.js";
import { registerPlays } from "./commands/plays.js";
import { registerProfile } from "./commands/profile.js";
import { registerWhoKnows } from "./commands/whoknows.js";
import { registerScrobbling } from "./commands/scrobbling.js";
import { registerCardEditor } from "./commands/cardeditor.js";
import { registerItunes } from "./commands/itunes.js";
import { registerCollage } from "./commands/collage.js";
import { registerSearch } from "./commands/search.js";
import { registerTagBrowser } from "./commands/tagbrowser.js";
import { registerTagging } from "./commands/tagging.js";
import { registerFriends } from "./commands/friends.js";
import { registerPersonal } from "./commands/personal.js";
import { registerSocial } from "./commands/social.js";
import { registerWeekly } from "./commands/weekly.js";
import { registerInfo } from "./commands/info.js";
import { registerDiscovery } from "./commands/discovery.js";
import { registerInsights } from "./commands/insights.js";
import { registerSettings } from "./settings.js";
import { registerLastfmHooks } from "./hooks.js";
import { registerListeningProvider } from "./listening.js";
import { registerLastfmRoutes } from "./web.js";
import { registerLastfmSlash } from "./slashsetup.js";

export const lastfmCog: Cog = {
  name: "lastfm",
  description: "Last.fm accounts, listening stats, server charts and customisation",
  setup(ctx) {
    registerAccount();
    registerNowPlaying();
    registerCharts();
    registerPlays();
    registerProfile();
    registerCompare();
    registerWhoKnows();
    registerCrowns();
    registerBoard();
    registerCustomCommands();
    registerAlbumArt();
    registerInsights();
    registerDiscovery();
    registerInfo();
    registerWeekly();
    registerSocial();
    registerPersonal();
    registerScrobbling();
    registerCardEditor();
    registerItunes();
    registerCollage();
    registerSearch();
    registerTagBrowser();
    registerTagging();
    registerFriends();
    registerSettings();

    registerLastfmHooks();
    registerListeningProvider();
    registerLastfmRoutes(ctx.web);

    // Last, so every command above is in the registry when the tree is built.
    registerLastfmSlash();
  },
};
