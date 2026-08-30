/**
 * Documentation catalog for the help menu.
 *
 * Data only: no imports, no logic, no side effects. Every `name` here is the
 * primary name a command is registered under in ../core/prefix.ts, so the help
 * menu can look each one up in the live registry and notice a drift.
 *
 * Written against what the handlers actually do. Argument shapes, caps and
 * permission checks all come from the source rather than from the one-line
 * `description` each register() call carries.
 */

export interface SubcommandDoc {
  name: string;
  usage: string;
  summary: string;
  permission?: string;
}

export interface CommandDoc {
  name: string;
  category: string;
  usage: string;
  summary: string;
  details?: string;
  examples?: string[];
  subcommands?: SubcommandDoc[];
  permission?: string;
  guildOnly?: boolean;
}

export interface CategoryDoc {
  slug: string;
  label: string;
  emoji: string;
  blurb: string;
}

export const CATEGORIES: CategoryDoc[] = [
  {
    slug: "general",
    label: "General",
    emoji: "",
    blurb: "Bot commands that work with or without a linked account",
  },
  {
    slug: "account",
    label: "Account",
    emoji: "",
    blurb: "Linking a Last.fm account so the other commands know who you are",
  },
  {
    slug: "nowplaying",
    label: "Now Playing",
    emoji: "",
    blurb: "What you or someone else is playing right now",
  },
  {
    slug: "charts",
    label: "Charts",
    emoji: "",
    blurb: "Top artists, albums and tracks over any period",
  },
  {
    slug: "plays",
    label: "Play Counts",
    emoji: "",
    blurb: "Play counts for one artist, album or track",
  },
  {
    slug: "profile",
    label: "Profile",
    emoji: "",
    blurb: "Listening history, milestones and derived stats",
  },
  {
    slug: "compare",
    label: "Compare",
    emoji: "",
    blurb: "Your taste against someone else's, plus something new to hear",
  },
  {
    slug: "server",
    label: "Server",
    emoji: "",
    blurb: "Server-wide listening, artist crowns and the vote boards",
  },
  {
    slug: "customize",
    label: "Customization",
    emoji: "",
    blurb: "Card styles, colours, reactions, command words and artwork",
  },
];

export const DOCS: CommandDoc[] = [
  /* ---------------------------------------------------------------- */
  /* general                                                          */
  /* ---------------------------------------------------------------- */
  {
    name: "ping",
    category: "general",
    usage: ",ping",
    summary: "Show the gateway latency",
    details:
      "Replies with a small card carrying the current gateway latency. It takes no arguments and reads nothing but the shard manager.",
    examples: [",ping"],
  },
  {
    name: "botinfo",
    category: "general",
    usage: ",botinfo",
    summary: "Latency, uptime, memory and library versions",
    details:
      "Lists ping, uptime, RSS and heap use, shard count, platform, Node version and the discordeno version, with a link button to the library's repository. Aliases: ,about and ,bi.",
    examples: [",botinfo", ",bi"],
  },
  {
    name: "test",
    category: "general",
    usage: ",test",
    summary: "Post the Components V2 showcase",
    details:
      "Sends two messages: one with every layout component, one with the interactive ones plus a small text file. It is split in two because a message holds five action rows and the select menus alone fill all five.",
    examples: [",test"],
  },
  {
    name: "help",
    category: "general",
    usage: ",help [command|category]",
    summary: "Browse every command",
    details:
      "With no argument it opens the category browser; a command name or alias shows that command's card, a category name shows that category's list, and anything else gets a short nothing-found card. The menus only answer to whoever ran it, and the view is stored in the component ids, so it still works after a restart. Aliases: ,h, ,commands and ,cmds.",
    examples: [",help", ",help np", ",help charts"],
  },

  /* ---------------------------------------------------------------- */
  /* account                                                          */
  /* ---------------------------------------------------------------- */
  {
    name: "lastfm",
    category: "account",
    usage: ",lastfm [subcommand]",
    summary: "Link and inspect your Last.fm account",
    details:
      "On its own it shows which account you are linked to, your scrobble total and a button to open the profile; any word it does not recognise falls through to a short help card. The status card and ,lf link need the bot's Last.fm API credentials and refuse without them, while ,lf unlink and ,lf np still run. Aliases: ,lf and ,fm.",
    examples: [",lf", ",lf link", ",lf np"],
    subcommands: [
      {
        name: "link",
        usage: ",lf link",
        summary: "DMs a link that expires in 10 minutes (also ,lf login or ,lf connect)",
      },
      {
        name: "unlink",
        usage: ",lf unlink",
        summary:
          "Disconnects the account linked to you (also ,lf remove or ,lf logout)",
      },
      {
        name: "np",
        usage: ",lf np [member|username]",
        summary: "The same handler as ,nowplaying (also ,lf now or ,lf nowplaying)",
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* nowplaying                                                       */
  /* ---------------------------------------------------------------- */
  {
    name: "nowplaying",
    category: "nowplaying",
    usage: ",nowplaying [member|username]",
    summary: "Show the current or most recent scrobble",
    details:
      "Takes nothing (you), a mention, or a bare Last.fm username of 2-20 letters, digits, dots, dashes or underscores. Layout and colour come from your ,lfmode and ,lfcolor settings, a cover submitted with ,lfurl beats Last.fm's own artwork, and each card is seeded with the up/down reactions that feed ,scoreboard. Aliases: ,np and ,fmnp.",
    examples: [",np", ",np @jackal", ",np rj"],
  },

  /* ---------------------------------------------------------------- */
  /* charts                                                           */
  /* ---------------------------------------------------------------- */
  {
    name: "topartists",
    category: "charts",
    usage: ",topartists [member] [period]",
    summary: "Your most listened to artists",
    details:
      "The period words are overall/all/alltime/a, week/weekly/7day/7days/7d/w, month/monthly/1month/30days/1m/m, 3month/3months/3m/quarter, 6month/6months/6m/half and year/yearly/12month/12months/1y/y; anything else is left alone and the period falls back to overall. The period can sit anywhere in the argument, at most 250 rows are fetched, ten per page, and the footer still reports the true total. Aliases: ,ta, ,tar and ,artists.",
    examples: [",ta", ",topartists week", ",ta @jackal year"],
  },
  {
    name: "topalbums",
    category: "charts",
    usage: ",topalbums [member] [period]",
    summary: "Your most listened to albums",
    details:
      "Same period words and same 250-row cap as ,topartists, with each album's artist on the line. Aliases: ,tal and ,albums.",
    examples: [",tal", ",topalbums month", ",tal @jackal overall"],
  },
  {
    name: "toptracks",
    category: "charts",
    usage: ",toptracks [member] [period]",
    summary: "Your most listened to tracks",
    details:
      "Same period words and same 250-row cap as ,topartists, with each track's artist on the line. Aliases: ,tt and ,tracks.",
    examples: [",tt", ",toptracks 3month", ",tt @jackal week"],
  },

  /* ---------------------------------------------------------------- */
  /* plays                                                            */
  /* ---------------------------------------------------------------- */
  {
    name: "plays",
    category: "plays",
    usage: ",plays [member] <artist>",
    summary: "Your play count for an artist",
    details:
      "The artist is taken verbatim, so no dash is needed. Leave it out and it uses the artist of whatever the target is playing now; the card adds global listener and play figures when Last.fm supplies them. Aliases: ,artistplays and ,ap.",
    examples: [",plays", ",plays Boards of Canada", ",ap @jackal Radiohead"],
  },
  {
    name: "playsalbum",
    category: "plays",
    usage: ",playsalbum [member] <artist - album>",
    summary: "Your play count for an album",
    details:
      "Split the two halves with a space, a dash and a space (en and em dashes work too). Only the first separator counts, so \"Artist - Album - Deluxe Edition\" keeps the suffix on the album, and with no operand it uses the album of the current scrobble and says so when that scrobble has none. Aliases: ,albumplays and ,pa.",
    examples: [",pa", ",playsalbum Radiohead - In Rainbows", ",pa @jackal Jay-Z - The Blueprint"],
  },
  {
    name: "playstrack",
    category: "plays",
    usage: ",playstrack [member] <artist - track>",
    summary: "Your play count for a track",
    details:
      "Same space-dash-space split as ,playsalbum. With no operand it uses the track playing now, and the card names the album the track belongs to when Last.fm knows it. Aliases: ,trackplays and ,pt.",
    examples: [",pt", ",playstrack Foo Fighters - Everlong"],
  },
  {
    name: "playsall",
    category: "plays",
    usage: ",playsall [member] <artist - album>",
    summary: "Your plays for every track on an album",
    details:
      "Lists the album's tracklist with your count against each track and the sum in the footer. It costs one lookup per track, so only the first 50 are counted and the heading says so when an album is longer. Aliases: ,albumtracks and ,pall.",
    examples: [",pall", ",playsall Daft Punk - Discovery"],
  },
  {
    name: "toptenalbums",
    category: "plays",
    usage: ",toptenalbums [member] <artist> [period]",
    summary: "Your top 10 albums for one artist",
    details:
      "Your album chart narrowed to one artist. A period word only counts here as the very last word, so names like \"Half Moon Run\" and \"All Them Witches\" survive intact, and with no artist it uses the one playing now. Aliases: ,tta and ,t10a.",
    examples: [",tta", ",toptenalbums Radiohead", ",tta Nirvana week"],
  },
  {
    name: "toptentracks",
    category: "plays",
    usage: ",toptentracks [member] <artist> [period]",
    summary: "Your top 10 tracks for one artist",
    details:
      "The track version of ,toptenalbums, with the same last-word-only period rule and the same fallback to the artist playing now. Aliases: ,ttt and ,t10t.",
    examples: [",ttt", ",toptentracks Nirvana", ",ttt Radiohead year"],
  },
  {
    name: "overview",
    category: "plays",
    usage: ",overview [member] <artist>",
    summary: "Combined stats for one artist",
    details:
      "One card with your play count, the artist's listeners and worldwide plays, and your top three albums and top three tracks by them. The two mini-charts are always overall, whatever period is typed. Aliases: ,artistoverview and ,ov.",
    examples: [",ov", ",overview Aphex Twin", ",ov @jackal Björk"],
  },

  /* ---------------------------------------------------------------- */
  /* profile                                                          */
  /* ---------------------------------------------------------------- */
  {
    name: "count",
    category: "profile",
    usage: ",count [member]",
    summary: "Total scrobbles for you or someone else",
    details: "A single figure with a link to the Last.fm profile it came from. Alias: ,scrobbles.",
    examples: [",count", ",count @jackal"],
  },
  {
    name: "whois",
    category: "profile",
    usage: ",whois [member]",
    summary: "Last.fm profile details",
    details:
      "Real name, country, scrobbles, distinct artist, album and track counts, and the registration date. Rows that Last.fm leaves empty or zero are dropped rather than shown blank. Alias: ,lfprofile.",
    examples: [",whois", ",whois @jackal"],
  },
  {
    name: "recent",
    category: "profile",
    usage: ",recent [member]",
    summary: "Recently scrobbled tracks",
    details:
      "The last 100 scrobbles, ten per page, each with its artist and a relative timestamp. A track playing right now is marked as such instead of getting a time. Aliases: ,recents and ,rt.",
    examples: [",recent", ",rt @jackal"],
  },
  {
    name: "recentfor",
    category: "profile",
    usage: ",recentfor [member] <artist>",
    summary: "Recent scrobbles filtered to one artist",
    details:
      "Last.fm has no per-artist history endpoint, so this walks your own feed and keeps the rows whose artist name contains what you typed, ignoring case. The walk stops after five pages of 200 scrobbles or 100 matches, whichever comes first. Aliases: ,rf and ,recentartist.",
    examples: [",recentfor radiohead", ",rf @jackal boards of canada"],
  },
  {
    name: "favorites",
    category: "profile",
    usage: ",favorites [member]",
    summary: "Tracks you have loved on Last.fm",
    details:
      "Up to 200 loved tracks, newest first, with the date each was loved. Aliases: ,favourites, ,loved and ,likes.",
    examples: [",loved", ",favorites @jackal"],
  },
  {
    name: "milestone",
    category: "profile",
    usage: ",milestone [member] <number>",
    summary: "Look up the Nth scrobble of an account",
    details:
      "Counts from the first scrobble, so ,milestone 1 is the oldest one on the account. Commas in the number are ignored, and anything outside 1 to the lifetime total is refused with the real range. Alias: ,ms.",
    examples: [",milestone 1000", ",ms @jackal 1", ",milestone 10,000"],
  },
  {
    name: "streak",
    category: "profile",
    usage: ",streak [member]",
    summary: "Current run of the same artist, album and track",
    details:
      "Counts how far back the top of your history keeps repeating, on artist, album and track at once. Only the last 200 scrobbles are walked, so a run that fills the whole window is reported open-ended as \"N+\". Alias: ,streaks.",
    examples: [",streak", ",streak @jackal"],
  },
  {
    name: "score",
    category: "profile",
    usage: ",score [member]",
    summary: "A listening score derived from your history",
    details:
      "A 0-100 bar built from three capped parts: volume from your scrobble total (up to 40), habit from scrobbles per day since you registered (up to 35) and variety from your distinct artist count (up to 25). The band names run from Newcomer up to Terminal. Alias: ,rating.",
    examples: [",score", ",rating @jackal"],
  },

  /* ---------------------------------------------------------------- */
  /* compare                                                          */
  /* ---------------------------------------------------------------- */
  {
    name: "taste",
    category: "compare",
    usage: ",taste <member> [period]",
    summary: "Compare your top artists with another member's",
    details:
      "The mention is required; without one you get a usage card instead of a self-comparison. It compares the top 100 artists on each side and lists the shared artists with both play counts, plus a match percentage over the smaller of the two sets. Aliases: ,compare and ,tastecompare.",
    examples: [",taste @jackal", ",taste @jackal week", ",compare @jackal year"],
  },
  {
    name: "recommendation",
    category: "compare",
    usage: ",recommendation [member]",
    summary: "Suggest an artist you have not heard yet",
    details:
      "Takes a seed from your top 30 artists, asks Last.fm for its neighbours, and checks the pick really is unplayed (more than five scrobbles and it is skipped). Your top 300 artists count as already heard, and the pick is shuffled, so running it again gives a different answer. Aliases: ,rec and ,recommend.",
    examples: [",rec", ",recommendation @jackal"],
  },

  /* ---------------------------------------------------------------- */
  /* server                                                           */
  /* ---------------------------------------------------------------- */
  {
    name: "whoknows",
    category: "server",
    usage: ",whoknows [member] <artist>",
    summary: "Top listeners for an artist in this server",
    details:
      "One Last.fm lookup per linked member, so at most 100 members are scanned, five at a time, and the footer says when the list was cut. The top listener takes the artist's crown once at least two people have plays and the scan saw everyone; a leading mention only picks whose current scrobble to use when you name no artist. Alias: ,wk.",
    examples: [",wk", ",whoknows Radiohead", ",wk @jackal"],
    guildOnly: true,
  },
  {
    name: "wkalbum",
    category: "server",
    usage: ",wkalbum [member] <artist - album>",
    summary: "Top listeners for an album in this server",
    details:
      "Same scan and same caps as ,whoknows, split on a space-dash-space. Albums never award crowns, and with no operand it uses the album playing now. Alias: ,wka.",
    examples: [",wka", ",wkalbum Radiohead - In Rainbows"],
    guildOnly: true,
  },
  {
    name: "wktrack",
    category: "server",
    usage: ",wktrack [member] <artist - track>",
    summary: "Top listeners for a track in this server",
    details:
      "Same scan and same caps as ,whoknows, split on a space-dash-space, falling back to the track playing now. Alias: ,wkt.",
    examples: [",wkt", ",wktrack Foo Fighters - Everlong"],
    guildOnly: true,
  },
  {
    name: "globalwhoknows",
    category: "server",
    usage: ",globalwhoknows [member] <artist>",
    summary: "Top listeners for an artist across every linked account",
    details:
      "The same ranking over everyone who has linked an account anywhere, oldest link first and capped at 100. No crowns are awarded, and rows carry Last.fm usernames because there is no one server to read nicknames from. Alias: ,gwk.",
    examples: [",gwk", ",globalwhoknows Radiohead"],
  },
  {
    name: "globalwkalbum",
    category: "server",
    usage: ",globalwkalbum [member] <artist - album>",
    summary: "Top listeners for an album across every linked account",
    details: "The global version of ,wkalbum, capped at the first 100 linked accounts. Alias: ,gwka.",
    examples: [",gwka", ",globalwkalbum Daft Punk - Discovery"],
  },
  {
    name: "globalwktrack",
    category: "server",
    usage: ",globalwktrack [member] <artist - track>",
    summary: "Top listeners for a track across every linked account",
    details: "The global version of ,wktrack, capped at the first 100 linked accounts. Alias: ,gwkt.",
    examples: [",gwkt", ",globalwktrack Foo Fighters - Everlong"],
  },
  {
    name: "crowns",
    category: "server",
    usage: ",crowns [member]",
    summary: "Artists you are the top listener for in this server",
    details:
      "Crowns are won by running ,whoknows and coming out on top. The member argument takes a mention or a bare user id, and up to 250 crowns are listed, highest play count first.",
    examples: [",crowns", ",crowns @jackal"],
    guildOnly: true,
  },
  {
    name: "mostcrowns",
    category: "server",
    usage: ",mostcrowns",
    summary: "Who holds the most crowns in this server",
    details:
      "The top 100 crown holders here. Anyone hidden with ,hide is left out, since a hidden member cannot add to the tally. Aliases: ,crownleaderboard and ,cl.",
    examples: [",mostcrowns", ",cl"],
    guildOnly: true,
  },
  {
    name: "playing",
    category: "server",
    usage: ",playing",
    summary: "What the server is listening to right now",
    details:
      "Checks the first 100 linked members of this server, five at a time, and lists only the ones with a live scrobble. A recently played track does not count, and hidden members are skipped.",
    examples: [",playing"],
    guildOnly: true,
  },
  {
    name: "hide",
    category: "server",
    usage: ",hide [member]",
    summary: "Hide a member from whoknows and server listings",
    details:
      "A toggle: run it on the same member again to unhide them. Hiding yourself is always allowed, hiding anyone else needs Manage Server, and the argument takes a mention or a bare user id.",
    examples: [",hide", ",hide @jackal", ",hide list"],
    permission: "Manage Server (to hide someone else)",
    guildOnly: true,
    subcommands: [
      {
        name: "list",
        usage: ",hide list",
        summary: "Everyone hidden here, up to 100, newest first",
      },
    ],
  },
  {
    name: "scoreboard",
    category: "server",
    usage: ",scoreboard",
    summary: "This server's now-playing vote tally",
    details:
      "Every ,np card is posted with up and down reactions, and reacting to someone else's card is a vote. This ranks the server's members by net score, top 100; the bot's own seeded reactions never count. Alias: ,sb.",
    examples: [",scoreboard", ",sb"],
    guildOnly: true,
  },
  {
    name: "globalboard",
    category: "server",
    usage: ",globalboard",
    summary: "The now-playing vote tally across every server",
    details:
      "The same tally over every server, grouped by Last.fm username so one person's score follows them between servers. Top 100. Alias: ,gb.",
    examples: [",globalboard", ",gb"],
  },

  /* ---------------------------------------------------------------- */
  /* customize                                                        */
  /* ---------------------------------------------------------------- */
  {
    name: "lfmode",
    category: "customize",
    usage: ",lfmode [style]",
    summary: "Choose how your now playing posts look",
    details:
      "The styles are default (a two-column Track/Artist embed), compact (a single line), detailed (adds album, plays and scrobbles) and container (the card style the rest of the bot uses). With no argument it lists them and marks the one you are on; reset, clear, none or off puts it back to default. Aliases: ,npmode and ,mode.",
    examples: [",lfmode", ",lfmode compact", ",mode reset"],
  },
  {
    name: "lfcolor",
    category: "customize",
    usage: ",lfcolor [hex|random|default]",
    summary: "Set the colour of your Last.fm cards",
    details:
      "Takes a six-digit hex colour with or without the leading hash, random for a random one, or default/reset/clear/none/off to go back to the house grey. The confirmation card is drawn in the colour just saved, so it doubles as the preview. Aliases: ,npcolor and ,color.",
    examples: [",lfcolor", ",lfcolor #1db954", ",color random"],
  },
  {
    name: "customreactions",
    category: "customize",
    usage: ",customreactions <up> <down>",
    summary: "Set your own up/down reactions for now playing posts",
    details:
      "Exactly two different emoji, either normal unicode ones or a custom emoji written as <:name:id>, which only works if the bot is in the server that owns it. With no argument it shows the pair your posts would really get and where each side comes from; reset, clear, none or off drops back to the server's pair and then the defaults. Aliases: ,myreactions and ,cr.",
    examples: [",customreactions", ",cr reset"],
  },
  {
    name: "react",
    category: "customize",
    usage: ",react <up> <down>",
    summary: "Set this server's up/down reactions",
    details:
      "The server-wide fallback pair, used by anyone who has not set their own with ,customreactions. Reading it with no argument is open to everyone; changing or clearing it needs Manage Server. Aliases: ,serverreactions and ,setreactions.",
    examples: [",react", ",react reset"],
    permission: "Manage Server (to change it)",
    guildOnly: true,
  },
  {
    name: "customcommand",
    category: "customize",
    usage: ",customcommand <word>",
    summary: "Claim your own word for your now playing in this server",
    details:
      "Claim a word and running it here shows your now playing, so ,cc vibes gives you ,vibes. A word is 2-20 characters of letters, digits, dashes and underscores, cannot be one of the bot's own commands or one of the subcommands below, and you get one per server: claiming another replaces it, and only you can run yours until a moderator makes it public. Alias: ,cc.",
    examples: [",cc", ",cc vibes", ",cc remove"],
    guildOnly: true,
    subcommands: [
      {
        name: "remove",
        usage: ",cc remove [member]",
        summary: "Drop your word, or someone else's (also ,cc delete or ,cc unset)",
        permission: "Manage Server (for someone else's)",
      },
      {
        name: "list",
        usage: ",cc list",
        summary: "Every custom command here, up to 100, with a public marker",
        permission: "Manage Server",
      },
      {
        name: "reset",
        usage: ",cc reset",
        summary: "Delete every custom command in this server (also ,cc clear)",
        permission: "Manage Server",
      },
      {
        name: "cleanup",
        usage: ",cc cleanup",
        summary: "Delete words owned by members who left; needs a full member list",
        permission: "Manage Server",
      },
      {
        name: "public",
        usage: ",cc public [word|member]",
        summary: "Toggle whether anyone may run that word (yours by default)",
        permission: "Manage Server",
      },
      {
        name: "blacklist",
        usage: ",cc blacklist <member>",
        summary: "Toggle a member's custom-command ban; blocking deletes their word",
        permission: "Manage Server",
      },
      {
        name: "blacklist list",
        usage: ",cc blacklist list",
        summary: "Who is blacklisted here, up to 100, newest first",
        permission: "Manage Server",
      },
      {
        name: "help",
        usage: ",cc help",
        summary: "The same summary card a bare ,cc prints",
      },
    ],
  },
  {
    name: "lfurl",
    category: "customize",
    usage: ",lfurl <image url> [artist - album]",
    summary: "Submit community album artwork",
    details:
      "The image URL comes first and everything after it is the album; leave the album off to use what you are playing now. Links must be http or https on a public host and either end in .png, .jpg, .jpeg, .gif or .webp or sit on a known image host such as imgur, and an album holds at most 25 submissions. Aliases: ,albumart and ,setcover.",
    examples: [
      ",lfurl https://i.imgur.com/abc123.png",
      ",lfurl https://i.imgur.com/abc123.png Radiohead - In Rainbows",
    ],
  },
  {
    name: "vote",
    category: "customize",
    usage: ",vote [n] [artist - album]",
    summary: "Show submitted album artwork and vote for one",
    details:
      "With no leading number it lists an album's submissions in submission order, marking the one in use and the ones you voted for; with a number it toggles your vote on that entry. Most votes wins, the oldest submission holds a tie, the winner is what ,np renders, and leaving the album off uses the album you are playing. Alias: ,votecover.",
    examples: [",vote", ",vote Radiohead - In Rainbows", ",vote 2 Radiohead - In Rainbows"],
  },
];
