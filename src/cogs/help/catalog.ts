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
  {
    slug: "booster",
    label: "Booster roles",
    emoji: "",
    blurb: "Personal colour roles for members who boost",
  },
  {
    slug: "filter",
    label: "Filters",
    emoji: "",
    blurb: "Keeping the chat clean",
  },
  {
    slug: "gallery",
    label: "Gallery channels",
    emoji: "",
    blurb: "Channels that only take images",
  },
  {
    slug: "sticky",
    label: "Sticky messages",
    emoji: "",
    blurb: "A message kept at the bottom of a channel",
  },
  {
    slug: "alias",
    label: "Aliases",
    emoji: "",
    blurb: "Server shortcuts for existing commands",
  },
  {
    slug: "welcome",
    label: "Welcome",
    emoji: "",
    blurb: "What the bot posts when somebody joins",
  },
  {
    slug: "goodbye",
    label: "Goodbye",
    emoji: "",
    blurb: "What the bot posts when somebody leaves",
  },
  {
    slug: "boost",
    label: "Boost messages",
    emoji: "",
    blurb: "What the bot posts when somebody boosts",
  },
  {
    slug: "autoresponder",
    label: "Autoresponder",
    emoji: "",
    blurb: "Automatic replies when a message matches a trigger",
  },
  {
    slug: "appearance",
    label: "Server look",
    emoji: "",
    blurb: "The server icon, banner and splash background",
  },
  {
    slug: "pins",
    label: "Pin archive",
    emoji: "",
    blurb: "Flushing a channel's pins into an archive channel",
  },
  {
    slug: "reposter",
    label: "Reposter",
    emoji: "",
    blurb: "Reposting social links so the video plays inline",
  },
  {
    slug: "fakeperms",
    label: "Fake permissions",
    emoji: "",
    blurb: "Letting a role use the bot without the real Discord permission",
  },
  {
    slug: "webhook",
    label: "Webhooks",
    emoji: "",
    blurb: "Posting as a named identity in a channel",
  },
  {
    slug: "extract",
    label: "Extract",
    emoji: "",
    blurb: "Downloading a server's emojis or stickers in one go",
  },
  {
    slug: "messages",
    label: "Messages",
    emoji: "",
    blurb: "Pinning, unpinning and finding a channel's first message",
  },
  {
    slug: "ignore",
    label: "Ignore",
    emoji: "",
    blurb: "Members and channels the bot reads nothing from",
  },
  {
    slug: "availability",
    label: "Availability",
    emoji: "",
    blurb: "Turning commands, modules and events off per channel",
  },
  {
    slug: "pagination",
    label: "Pagination",
    emoji: "",
    blurb: "Several pages behind one message, turned with arrows",
  },
  {
    slug: "snipe",
    label: "Snipe",
    emoji: "",
    blurb: "What was deleted, edited or unreacted in a channel",
  },
  {
    slug: "prefix",
    label: "Prefix",
    emoji: "",
    blurb: "What the bot answers to in this server",
  },
  {
    slug: "library",
    label: "Library",
    emoji: "",
    blurb: "Loved tracks, your own tags and everything you have saved",
  },
  {
    slug: "scrobbling",
    label: "Scrobbling",
    emoji: "",
    blurb: "Writing to your Last.fm account: scrobbles, loves and corrections",
  },
  {
    slug: "insights",
    label: "Insights",
    emoji: "",
    blurb: "Patterns in how you listen, from streaks to obscurity",
  },
  {
    slug: "weekly",
    label: "Weekly",
    emoji: "",
    blurb: "What the last seven days looked like",
  },
  {
    slug: "discovery",
    label: "Discovery",
    emoji: "",
    blurb: "Finding artists, albums and tracks you have not heard",
  },
  {
    slug: "info",
    label: "Info",
    emoji: "",
    blurb: "Facts about one artist, album or track",
  },
  {
    slug: "tags",
    label: "Tags",
    emoji: "",
    blurb: "Browsing and applying Last.fm tags",
  },
  {
    slug: "search",
    label: "Search",
    emoji: "",
    blurb: "Looking things up on Last.fm and iTunes",
  },
  {
    slug: "artwork",
    label: "Artwork",
    emoji: "",
    blurb: "Cover art, collages and the images on your cards",
  },
  {
    slug: "social",
    label: "Social",
    emoji: "",
    blurb: "Friends, sharing and what other people are playing",
  },
];

export const DOCS: CommandDoc[] = [
  {
    name: "filter",
    category: "filter",
    usage: ",filter",
    summary: "Keep the chat clean",
    details:
      "Filtered words are held as a Discord AutoMod rule rather than scanned by the bot, so a blocked message never posts at all and the rule keeps working even when the bot is offline. Wildcards like spam* are supported, whitelisting lets a longer word through, and roles can be exempted. Discord allows six keyword rules per server in total and the overview says how many are left. Alias: ,chatfilter.",
    examples: [",filter", ",filter add badword", ",filter list"],
    permission: "Manage Channels (reset needs Manage Server)",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",filter add <word>", summary: "Filter a word", permission: "Manage Channels" },
      { name: "remove", usage: ",filter remove <word>", summary: "Stop filtering a word", permission: "Manage Channels" },
      { name: "whitelist", usage: ",filter whitelist <word>", summary: "Let a word through", permission: "Manage Channels" },
      { name: "exempt", usage: ",filter exempt <role>", summary: "Exempt a role, or list the exempt ones", permission: "Manage Channels" },
      { name: "list", usage: ",filter list", summary: "Every filtered word", permission: "Manage Channels" },
      { name: "reset", usage: ",filter reset", summary: "Clear every filtered word", permission: "Manage Server" },
    ],
  },
  {
    name: "imgonly",
    category: "gallery",
    usage: ",imgonly",
    summary: "Make a channel take images only",
    details:
      "A post in a gallery channel has to carry an image; a caption alongside it is fine, which is the point. An image counts as an attachment Discord marked as an image, a file with an image extension, or a direct link to one. Anything else is deleted, so the bot needs Manage Messages there. Members with Manage Server are exempt, or setting the channel up from inside it would delete the command. Aliases: ,gallery and ,imageonly.",
    examples: [",imgonly", ",imgonly add #art", ",imgonly list"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",imgonly add <channel>", summary: "Make a channel take images only", permission: "Manage Server" },
      { name: "remove", usage: ",imgonly remove <channel>", summary: "Let a channel take anything again", permission: "Manage Server" },
      { name: "list", usage: ",imgonly list", summary: "Every gallery channel", permission: "Manage Server" },
    ],
  },
  {
    name: "welcome",
    category: "welcome",
    usage: ",welcome",
    summary: "Post a message when someone joins",
    details:
      "One message per channel, posted when a member joins, with the same variables the other greetings use. Discord only tells a bot about a join in two ways: the join system message, which needs a system channel with join messages switched on in Server Settings, or the privileged GuildMembers intent. Without one of those nothing fires, however the message is configured. Aliases: ,welcomemsg and ,greet.",
    examples: [",welcome", ",welcome add #general welcome {user}", ",welcome variables"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",welcome add <channel> <message>", summary: "Set what a channel posts", permission: "Manage Server" },
      { name: "view", usage: ",welcome view <channel>", summary: "Show a channel's message and its raw text", permission: "Manage Server" },
      { name: "remove", usage: ",welcome remove <channel>", summary: "Stop a channel posting", permission: "Manage Server" },
      { name: "list", usage: ",welcome list", summary: "Every channel with a welcome message", permission: "Manage Server" },
      { name: "variables", usage: ",welcome variables", summary: "Every variable a message can use", permission: "Manage Server" },
    ],
  },
  {
    name: "goodbye",
    category: "goodbye",
    usage: ",goodbye",
    summary: "Post a message when someone leaves",
    details:
      "One message per channel, posted when a member leaves. Discord sends no system message when somebody leaves, so unlike welcome there is no fallback: this needs the privileged GuildMembers intent enabled in the Developer Portal and GUILD_MEMBERS_INTENT=1 in the environment. The commands and storage work either way, so a server can be configured before the intent is switched on. Aliases: ,goodbyemsg and ,leave.",
    examples: [",goodbye", ",goodbye add #general {user.name} left", ",goodbye list"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",goodbye add <channel> <message>", summary: "Set what a channel posts", permission: "Manage Server" },
      { name: "view", usage: ",goodbye view <channel>", summary: "Show a channel's message and its raw text", permission: "Manage Server" },
      { name: "remove", usage: ",goodbye remove <channel>", summary: "Stop a channel posting", permission: "Manage Server" },
      { name: "list", usage: ",goodbye list", summary: "Every channel with a goodbye message", permission: "Manage Server" },
      { name: "variables", usage: ",goodbye variables", summary: "Every variable a message can use", permission: "Manage Server" },
    ],
  },
  {
    name: "autoresponder",
    category: "autoresponder",
    usage: ",autoresponder",
    summary: "Answer automatically when a message matches a trigger",
    details:
      "A trigger is matched on word boundaries anywhere in a message, so \"hi\" answers \"hi there\" but not \"this\". --strict narrows that to the whole message. Replies take the same variables the greetings use. Flags: --strict, --delete to remove the message that triggered it, --reply to answer as a reply, --ticket to mark it for ,autoresponder list tickets. A trigger can also give or take roles, and be limited to certain roles or channels. Up to 100 per server. Aliases: ,autoreply and ,ar.",
    examples: [
      ",autoresponder add hello, hey {user}!",
      ",autoresponder add rules, read <#123> --delete",
      ",autoresponder role add @Verified verify",
      ",autoresponder exclusive #general hello",
    ],
    permission: "Manage Channels",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",autoresponder add <trigger>, <reply>", summary: "Create a reply for a trigger", permission: "Manage Channels" },
      { name: "update", usage: ",autoresponder update <trigger>, <reply>", summary: "Change the reply for a trigger", permission: "Manage Channels" },
      { name: "remove", usage: ",autoresponder remove <trigger>", summary: "Remove a reply for a trigger", permission: "Manage Channels" },
      { name: "list", usage: ",autoresponder list", summary: "Every trigger in this server", permission: "Manage Channels" },
      { name: "variables", usage: ",autoresponder variables", summary: "What a reply can use", permission: "Manage Channels" },
      { name: "role", usage: ",autoresponder role", summary: "Give or take roles when a trigger fires", permission: "Manage Channels" },
      { name: "exclusive", usage: ",autoresponder exclusive <role or #channel> <trigger>", summary: "Limit a trigger to some roles or channels", permission: "Manage Channels" },
      { name: "reset", usage: ",autoresponder reset", summary: "Remove every auto response", permission: "Manage Channels" },
    ],
  },
  {
    name: "seticon",
    category: "appearance",
    usage: ",seticon <url>",
    summary: "Set the server icon",
    details:
      "Takes a link to a PNG, JPEG, GIF or WebP, fetches it and hands it to Discord as a data URI. The link is checked before anything is fetched: private and loopback addresses are refused, since the bot is what does the fetching. A banner needs boost level 2 and a splash background needs level 1, and those are checked against the server's features first so the failure is a sentence rather than a raw API error. Only a banner may be animated.",
    examples: [",seticon https://i.imgur.com/abc.png"],
    permission: "Manage Server",
    guildOnly: true,
  },
  {
    name: "reposter",
    category: "reposter",
    usage: ",reposter <on or off>",
    summary: "Repost social media links so the video plays",
    details:
      "When somebody posts an x, instagram, tiktok or reddit link, the bot reposts it through a service that lets Discord play the video inline. It does not download or scrape anything: Discord fetches the rewritten link itself, which is why this works from a datacenter address that tiktok and instagram would otherwise refuse. Five switches sit under it: embed names who posted, strict matches a link anywhere in a message rather than only a message that is nothing else, suppress hides the original preview, delete removes the original message, and prefix requires a server prefix before the link. Alias: ,repost.",
    examples: [",reposter on", ",reposter strict on", ",reposter delete on"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "embed", usage: ",reposter embed <on or off>", summary: "Name who posted the link", permission: "Manage Server" },
      { name: "strict", usage: ",reposter strict <on or off>", summary: "Match a link anywhere in a message", permission: "Manage Server" },
      { name: "suppress", usage: ",reposter suppress <on or off>", summary: "Hide the original preview", permission: "Manage Server" },
      { name: "delete", usage: ",reposter delete <on or off>", summary: "Delete the original message", permission: "Manage Server" },
      { name: "prefix", usage: ",reposter prefix <on or off>", summary: "Require a prefix before the link", permission: "Manage Server" },
    ],
  },
  {
    name: "fakepermissions",
    category: "fakeperms",
    usage: ",fakepermissions",
    summary: "Let a role use my commands without the real permission",
    details:
      "A fake permission changes what my commands allow and nothing else: nobody gains anything on Discord itself, and the role still cannot delete a channel by hand. Grantable are manage_messages, manage_channels, manage_guild, manage_roles, manage_webhooks and administrator, which is exactly the set my commands gate on. Server Owner only, and ownership is checked against the guild owner rather than a permission bit, so a granted role can never reach this command and grant itself more. @everyone is refused, since that would hand the permission to the whole server. Aliases: ,fakeperms and ,fp.",
    examples: [
      ",fakepermissions add @Moderator manage_messages",
      ",fakepermissions list @Moderator",
      ",fakepermissions remove @Moderator manage_messages",
    ],
    permission: "Server Owner",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",fakepermissions add <role> <permission>", summary: "Grant a fake permission to a role", permission: "Server Owner" },
      { name: "remove", usage: ",fakepermissions remove <role> <permission>", summary: "Take a fake permission back", permission: "Server Owner" },
      { name: "list", usage: ",fakepermissions list [role]", summary: "What a role has been granted", permission: "Server Owner" },
      { name: "reset", usage: ",fakepermissions reset", summary: "Clear every fake permission", permission: "Server Owner" },
    ],
  },
  {
    name: "webhook",
    category: "webhook",
    usage: ",webhook",
    summary: "Post as a named identity in a channel",
    details:
      "Each webhook gets a short id, and that id is what every other command takes. The URL is never printed and never stored: anyone holding a webhook URL can post as it with no authentication, so the token is fetched from Discord at the moment it is needed and kept nowhere. A message is sent as plain text, or as an embed if it contains brace fields like {title: ...}, the same page code the pin archive uses. Locking a webhook keeps it to you until you unlock it. Everything needs Manage Webhooks except list. Aliases: ,webhooks.",
    examples: [
      ",webhook create announcements",
      ",webhook send a1b2c3 hello everyone",
      ",webhook send a1b2c3 {title: Notice}{description: read this}",
      ",webhook lock a1b2c3",
    ],
    permission: "Manage Webhooks",
    guildOnly: true,
    subcommands: [
      { name: "create", usage: ",webhook create <name>", summary: "Make a webhook in this channel", permission: "Manage Webhooks" },
      { name: "list", usage: ",webhook list", summary: "Every webhook in this server" },
      { name: "send", usage: ",webhook send <id> <message>", summary: "Post through a webhook", permission: "Manage Webhooks" },
      { name: "edit", usage: ",webhook edit <link> <message>", summary: "Rewrite something a webhook posted", permission: "Manage Webhooks" },
      { name: "lock", usage: ",webhook lock <id>", summary: "Keep a webhook to yourself", permission: "Manage Webhooks" },
      { name: "unlock", usage: ",webhook unlock <id>", summary: "Give a webhook back to everyone", permission: "Manage Webhooks" },
      { name: "delete", usage: ",webhook delete <id>", summary: "Delete a webhook", permission: "Manage Webhooks" },
    ],
  },
  {
    name: "pins",
    category: "pins",
    usage: ",pins",
    summary: "Archive a channel's pins into another channel",
    details:
      "Discord caps a channel at 50 pins, and the archive is what you do when it fills. Set a destination with pins channel, then pins archive copies this channel's pins there oldest first, ten to a card, and unpins them unless you turned that off. pins set on does the same thing by itself once a channel reaches 45 pins, using Discord's own pin-update event. Run bare, pins shows the settings. Aliases: ,pinarchive.",
    examples: [",pins channel #pin-archive", ",pins set on", ",pins archive"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "config", usage: ",pins config", summary: "The pin archive settings", permission: "Manage Server" },
      { name: "channel", usage: ",pins channel <#channel>", summary: "Where archived pins go", permission: "Manage Server" },
      { name: "set", usage: ",pins set <on or off>", summary: "Switch automatic archiving on or off", permission: "Manage Server" },
      { name: "unpin", usage: ",pins unpin <on or off>", summary: "Whether archiving also unpins", permission: "Manage Server" },
      { name: "archive", usage: ",pins archive", summary: "Archive this channel's pins now", permission: "Manage Server" },
      { name: "reset", usage: ",pins reset", summary: "Clear the pin archive settings", permission: "Manage Server" },
    ],
  },
  {
    name: "extractemotes",
    category: "extract",
    usage: ",extractemotes",
    summary: "Send every emoji in this server as a zip",
    details:
      "Downloads every emoji from Discord's CDN and sends them back as one zip, animated ones as .gif and the rest as .png. Names come from the emoji, cleaned of anything a filesystem would object to, and a repeated name gets a number rather than overwriting. Six download at a time, nothing over 8MB each, and the archive stops at 24MB with the card saying how many were left out. Administrator, since it hands somebody the whole set at once. Alias: ,extractemojis.",
    examples: [",extractemotes"],
    permission: "Administrator",
    guildOnly: true,
  },
  {
    name: "extractstickers",
    category: "extract",
    usage: ",extractstickers",
    summary: "Send every sticker in this server as a zip",
    details:
      "The same as ,extractemotes for stickers. Discord stores stickers in three formats and the extension follows: PNG and APNG come out as .png, GIF as .gif, and a Lottie sticker as the .json it really is rather than an image that would not open.",
    examples: [",extractstickers"],
    permission: "Administrator",
    guildOnly: true,
  },
  {
    name: "pin",
    category: "messages",
    usage: ",pin [link]",
    summary: "Pin the last message, or one by link",
    details:
      "With nothing after it, this pins the most recent message in the channel that is not the command itself. With a message link or id it pins that one. It checks the 50-pin cap first and says so rather than letting Discord refuse.",
    examples: [",pin", ",pin https://discord.com/channels/1/2/3"],
    permission: "Manage Messages",
    guildOnly: true,
  },
  {
    name: "unpin",
    category: "messages",
    usage: ",unpin [link]",
    summary: "Unpin a message",
    details:
      "With nothing after it, this unpins the most recently pinned message. With a message link or id it unpins that one.",
    examples: [",unpin", ",unpin https://discord.com/channels/1/2/3"],
    permission: "Manage Messages",
    guildOnly: true,
  },
  {
    name: "firstmessage",
    category: "messages",
    usage: ",firstmessage [#channel]",
    summary: "Link the first message in a channel",
    details:
      "Reads the oldest message in a channel and gives you a jump link to it, with the author and the opening of what they said. Defaults to the channel you are in. Alias: ,first.",
    examples: [",firstmessage", ",firstmessage #general"],
    guildOnly: true,
  },
  {
    name: "ignore",
    category: "ignore",
    usage: ",ignore <member or #channel>",
    summary: "Stop reading a member or a channel",
    details:
      "An ignored member or channel is skipped entirely: no commands, and none of the things that happen without being asked either, so no autoresponder, no filters, no sticky repost, nothing recorded for snipe. Running it bare on a member or channel switches it on or off, and add and remove are there when you want to be explicit. The ignore commands themselves keep answering inside an ignored channel, so ignoring the channel you are standing in is never a dead end. Administrator only, because it silences the bot rather than narrowing it.",
    examples: [",ignore @someone", ",ignore add #spam", ",ignore list"],
    permission: "Administrator",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",ignore add <member or #channel>", summary: "Ignore a member or a channel", permission: "Administrator" },
      { name: "remove", usage: ",ignore remove <member or #channel>", summary: "Stop ignoring a member or a channel", permission: "Administrator" },
      { name: "list", usage: ",ignore list", summary: "Every ignored member and channel", permission: "Administrator" },
    ],
  },
  {
    name: "disablecommand",
    category: "availability",
    usage: ",disablecommand <#channel or @member> <command>",
    summary: "Turn a command off in a channel",
    details:
      "Three things can be switched off, each with its own pair of commands: a command, a module (a whole cog, so every command in it), and an event (something the bot does that is not a command, like the filters or the autoresponder). Everything takes a channel, and disablecommand also takes a member, so one person can lose a command without the channel losing it. Add all in place of the channel to cover the whole server. The commands that switch things back on can never be switched off themselves, or a server could lock itself out. Only whole commands can be disabled, not their subcommands.",
    examples: [
      ",disablecommand #general fm",
      ",disablecommand all crowns",
      ",disablecommand list",
      ",copydisabled #old #new",
    ],
    permission: "Manage Channels",
    guildOnly: true,
    subcommands: [
      { name: "all", usage: ",disablecommand all <command>", summary: "Turn a command off everywhere", permission: "Manage Channels" },
      { name: "list", usage: ",disablecommand list", summary: "Every command switched off here", permission: "Manage Channels" },
    ],
  },
  {
    name: "pagination",
    category: "pagination",
    usage: ",pagination",
    summary: "Put several pages behind one message",
    details:
      "Discord only lets a bot edit its own messages, so a pagination can only be built on an embed I posted: ,pagination set takes one of mine and makes it page 1. Pages after that are written in page code, the same brace style the rest of the bot uses. Readers turn pages with the Back and Next buttons underneath, which anyone can press. Page ids are stable and do not renumber when one is deleted, so an id in ,pagination list stays valid. Up to 25 pages per message and 50 paginations per server. Aliases: ,pages and ,paginate.",
    examples: [
      ",pagination set <link>",
      ",pagination add <link> {title: Rules}{description: Be nice}",
      ",pagination list",
    ],
    permission: "Manage Messages",
    guildOnly: true,
    subcommands: [
      { name: "set", usage: ",pagination set <link>", summary: "Turn one of my embeds into page 1", permission: "Manage Messages" },
      { name: "add", usage: ",pagination add <link> <code>", summary: "Add a page", permission: "Manage Messages" },
      { name: "update", usage: ",pagination update <link> <id> <code>", summary: "Rewrite one page", permission: "Manage Messages" },
      { name: "remove", usage: ",pagination remove <link> <id>", summary: "Delete one page", permission: "Manage Messages" },
      { name: "list", usage: ",pagination list", summary: "Every pagination in this server", permission: "Manage Messages" },
      { name: "restorebuttons", usage: ",pagination restorebuttons <link>", summary: "Put the buttons back", permission: "Manage Messages" },
      { name: "delete", usage: ",pagination delete <link>", summary: "Stop paginating a message", permission: "Manage Messages" },
      { name: "reset", usage: ",pagination reset", summary: "Clear every pagination in this server", permission: "Administrator" },
    ],
  },
  {
    name: "snipe",
    category: "snipe",
    usage: ",snipe [index]",
    summary: "Show the last message deleted here",
    details:
      "Deleted and edited messages are recovered from an in-process cache of recent messages, because Discord's delete event carries only an id, never the content. That cache is per channel, bounded, and lost on restart, so a snipe reaches back minutes rather than days. An index picks an older one: ,snipe 3 is the third most recent. Anything the bot deleted itself is never snipeable, so a filtered word cannot be recovered with ,snipe. A server manager can switch the whole thing off with ,filter snipe. Alias: ,s.",
    examples: [",snipe", ",snipe 3", ",snipe edit", ",snipe reaction"],
    guildOnly: true,
    subcommands: [
      { name: "edit", usage: ",snipe edit [index]", summary: "Show the last message edited here, before and after" },
      { name: "reaction", usage: ",snipe reaction", summary: "Show the last reaction removed here" },
      { name: "clear", usage: ",snipe clear", summary: "Clear every stored snipe in this server", permission: "Manage Messages" },
      { name: "reactionhistory", usage: ",snipe reactionhistory <link>", summary: "Every reaction logged for one message", permission: "Manage Messages" },
    ],
  },
  {
    name: "stickymessage",
    category: "sticky",
    usage: ",stickymessage",
    summary: "Keep a message at the bottom of a channel",
    details:
      "One message per channel, reposted so it stays the last thing in the channel. It waits for the chat to settle rather than reposting on every message, so a busy channel gets one repost instead of dozens, and the old copy is deleted before the new one goes up. The bot needs Manage Messages in the channel to delete its previous copy. Aliases: ,sticky and ,stickymsg.",
    examples: [",stickymessage", ",sticky add #rules read the rules", ",sticky list"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",stickymessage add <channel> <message>", summary: "Keep a message at the bottom of a channel", permission: "Manage Server" },
      { name: "view", usage: ",stickymessage view <channel>", summary: "Show what a channel keeps stuck", permission: "Manage Server" },
      { name: "remove", usage: ",stickymessage remove <channel>", summary: "Stop a channel keeping a message", permission: "Manage Server" },
      { name: "list", usage: ",stickymessage list", summary: "Every channel with a sticky message", permission: "Manage Server" },
    ],
  },
  {
    name: "alias",
    category: "alias",
    usage: ",alias",
    summary: "Make one word run another command",
    details:
      "A shortcut is one word this server treats as another command, and anything typed after it is passed straight through, so a shortcut for ,lastfm toptracks still takes a member and a period. A shortcut can never override a real command: if the word is already taken the alias is refused, and shortcuts are only consulted once nothing else matches. Up to 100 per server. Aliases: ,aliases and ,shortcut.",
    examples: [",alias add tt lastfm toptracks", ",alias list", ",alias view tt"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",alias add <shortcut> <command>", summary: "Point a word at a command", permission: "Manage Server" },
      { name: "remove", usage: ",alias remove <shortcut>", summary: "Delete one shortcut", permission: "Manage Server" },
      { name: "removeall", usage: ",alias removeall <command>", summary: "Delete every shortcut for a command", permission: "Manage Server" },
      { name: "view", usage: ",alias view <shortcut>", summary: "Show what a shortcut runs", permission: "Manage Server" },
      { name: "list", usage: ",alias list", summary: "Every shortcut in this server", permission: "Manage Server" },
      { name: "reset", usage: ",alias reset", summary: "Clear every shortcut", permission: "Manage Server" },
    ],
  },
  {
    name: "boosts",
    category: "boost",
    usage: ",boosts",
    summary: "Post a message when someone boosts",
    details:
      "Set a message per channel and every one of them posts when somebody boosts the server. The trigger is Discord's own boost system message, so it needs no privileged intent, but the server has to have boost messages switched on in Server Settings for that system message to appear. Variables in braces are filled in; anything in braces that is not a variable is left exactly as written. Aliases: ,boostmsg and ,boostmessage.",
    examples: [",boosts", ",boosts add #general thanks {user}!", ",boosts variables"],
    permission: "Manage Server",
    guildOnly: true,
    subcommands: [
      { name: "add", usage: ",boosts add <channel> <message>", summary: "Set what a channel posts", permission: "Manage Server" },
      { name: "view", usage: ",boosts view <channel>", summary: "Show a channel's message and its raw text", permission: "Manage Server" },
      { name: "remove", usage: ",boosts remove <channel>", summary: "Stop a channel posting", permission: "Manage Server" },
      { name: "list", usage: ",boosts list", summary: "Every channel with a boost message", permission: "Manage Server" },
      { name: "variables", usage: ",boosts variables", summary: "Every variable a message can use", permission: "Manage Server" },
    ],
  },
  {
    name: "boosterrole",
    category: "booster",
    usage: ",boosterrole <colour> [second colour] [name]",
    summary: "Give boosters a personal colour role",
    details:
      "Each booster gets one role of their own. Run it with a colour to create or recolour it, add a second colour for a gradient, and anything after that becomes the name. A gradient and an icon both need the server at boost level 2; without that Discord refuses and the card says so. New roles are placed under whatever boosterrole base names, and I need Manage Roles with my own role above them. Aliases: ,br and ,boostrole.",
    examples: [",boosterrole #1db954", ",br blue purple night owl", ",br random"],
    permission: "Server boosters (admin subcommands need Manage Server)",
    guildOnly: true,
    subcommands: [
      { name: "color", usage: ",boosterrole color <colour> [second] [name]", summary: "Set your colour, gradient and name" },
      { name: "random", usage: ",boosterrole random", summary: "Take a random colour" },
      { name: "dominant", usage: ",boosterrole dominant", summary: "Take the main colour out of your avatar" },
      { name: "rename", usage: ",boosterrole rename <name>", summary: "Rename your role" },
      { name: "icon", usage: ",boosterrole icon [url]", summary: "Set the role icon, or clear it with no url" },
      { name: "remove", usage: ",boosterrole remove", summary: "Delete your booster role" },
      { name: "share", usage: ",boosterrole share <member>", summary: "Let someone else wear your role" },
      { name: "share list", usage: ",boosterrole share list", summary: "Who is wearing your role" },
      { name: "share remove", usage: ",boosterrole share remove <role>", summary: "Leave a role someone shared with you" },
      { name: "share max", usage: ",boosterrole share max <number>", summary: "How many members one role may hold", permission: "Manage Server" },
      { name: "share limit", usage: ",boosterrole share limit <number>", summary: "How many shared roles a member may wear", permission: "Manage Server" },
      { name: "base", usage: ",boosterrole base <role>", summary: "The role new booster roles sit under", permission: "Manage Server" },
      { name: "limit", usage: ",boosterrole limit <number>", summary: "Cap how many booster roles exist", permission: "Manage Server" },
      { name: "award", usage: ",boosterrole award <role>", summary: "A role handed to anyone who boosts", permission: "Manage Server" },
      { name: "award view", usage: ",boosterrole award view", summary: "Show the current award role", permission: "Manage Server" },
      { name: "award unset", usage: ",boosterrole award unset", summary: "Clear the award role", permission: "Manage Server" },
      { name: "filter", usage: ",boosterrole filter <word>", summary: "Block or unblock a word in role names", permission: "Manage Server" },
      { name: "filter list", usage: ",boosterrole filter list", summary: "Every blocked word", permission: "Manage Server" },
      { name: "list", usage: ",boosterrole list", summary: "Every booster role and its owner", permission: "Manage Server" },
      { name: "link", usage: ",boosterrole link <member> <role>", summary: "Mark an existing role as someone's booster role", permission: "Manage Server" },
      { name: "cleanup", usage: ",boosterrole cleanup", summary: "Delete roles whose owner stopped boosting", permission: "Manage Server" },
    ],
  },
  {
    name: "prefix",
    category: "prefix",
    usage: ",prefix [subcommand]",
    summary: "Show and change what this server answers to",
    details:
      "On its own it lists every prefix the server currently answers to and how to change them. A server can hold as many as 25 prefixes at once, each at most 8 characters and with no spaces. Reading the list is open to everyone; add, set, remove and reset all need Manage Server. Mentioning the bot always works as a prefix, so a server can never lock itself out. Alias: ,prefixes.",
    examples: [",prefix", ",prefix add !", ",prefix set ?"],
    permission: "Manage Server (to change it)",
    guildOnly: true,
    subcommands: [
      { name: "list", usage: ",prefix list", summary: "Every prefix this server answers to" },
      {
        name: "add",
        usage: ",prefix add <prefix...>",
        summary: "Add one or more prefixes, keeping the ones already set",
        permission: "Manage Server",
      },
      {
        name: "remove",
        usage: ",prefix remove <prefix...>",
        summary: "Take prefixes away; removing the last one restores the default",
        permission: "Manage Server",
      },
      {
        name: "set",
        usage: ",prefix set <prefix...>",
        summary: "Replace every prefix with the ones you give",
        permission: "Manage Server",
      },
      {
        name: "reset",
        usage: ",prefix reset",
        summary: "Clear every custom prefix and go back to the default",
        permission: "Manage Server",
      },
    ],
  },
  {
    name: "ping",
    category: "general",
    usage: ",ping",
    summary: "Show the gateway latency",
    details:
      "Replies with the current gateway latency and nothing else. It takes no arguments and reads nothing but the shard manager.",
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
    usage: ",help [anything]",
    summary: "Search and browse every command",
    details:
      "With no argument it opens the browser. A command, alias, cog or category name goes straight there; anything else is searched across every name, alias and description and comes back ranked. /help autocompletes as you type. Inside the browser you can jump to a cog, open a group, page with first/back/next/last or type a page number, run an A-Z index, and press Run on any command. The menus only answer to whoever ran it, and the whole view is stored in the component ids, so it still works after a restart. Aliases: ,h, ,commands and ,cmds.",
    examples: [",help", ",help np", ",help charts", ",help top tracks"],
  },
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
  {
    name: "nowplaying",
    category: "nowplaying",
    usage: ",nowplaying [member|username]",
    summary: "Show the current or most recent scrobble",
    details:
      "Takes nothing (you), a mention, a bare Last.fm username of 2-20 letters, digits, dots, dashes or underscores, or a user:name token. Layout and colour come from your ,lfmode and ,lfcolor settings, a cover submitted with ,lfurl beats Last.fm's own artwork, and each card is seeded with the up/down reactions that feed ,scoreboard. Aliases: ,np and ,fmnp.",
    examples: [",np", ",np @jackal", ",np rj"],
  },
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
      "Last.fm cards have no colour out of the box. Set one and every Last.fm card you pull up carries it. Takes a six-digit hex colour with or without the leading hash, random for a random one, or default/reset/clear/none/off to go back to no colour. The confirmation card is drawn in the colour just saved, so it doubles as the preview. Aliases: ,npcolor and ,color.",
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
