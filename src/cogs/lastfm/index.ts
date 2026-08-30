import type { Cog } from "../../core/cog.js";
import { groupUnder, inCategory } from "../../core/prefix.js";
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

export const lastfmCog: Cog = {
  name: "lastfm",
  label: "LastFM",
  description: "Last.fm accounts, listening stats, server charts and customisation",
  setup(ctx) {
    inCategory("account", registerAccount);
    inCategory("nowplaying", registerNowPlaying);

    groupUnder("lastfm", () => {
      inCategory("charts", registerCharts);
      inCategory("plays", registerPlays);
      inCategory("profile", registerProfile);
      inCategory("compare", registerCompare);
      inCategory("server", registerWhoKnows);
      inCategory("server", registerCrowns);
      inCategory("server", registerBoard);
      inCategory("customize", registerCustomCommands);
      inCategory("artwork", registerAlbumArt);
      inCategory("insights", registerInsights);
      inCategory("discovery", registerDiscovery);
      inCategory("info", registerInfo);
      inCategory("weekly", registerWeekly);
      inCategory("social", registerSocial);
      inCategory("library", registerPersonal);
      inCategory("scrobbling", registerScrobbling);
      inCategory("customize", registerCardEditor);
      inCategory("search", registerItunes);
      inCategory("artwork", registerCollage);
      inCategory("search", registerSearch);
      inCategory("tags", registerTagBrowser);
      inCategory("tags", registerTagging);
      inCategory("social", registerFriends);
      inCategory("customize", registerSettings);
    });

    registerLastfmHooks();
    registerListeningProvider();
    registerLastfmRoutes(ctx.web);
  },
};
