import { container, gallery, text, IS_COMPONENTS_V2 } from "../../helpers/components.js";
import { inCategory, register, type PrefixContext } from "../../core/prefix.js";
import { gifFor } from "./gifs.js";
import { enabled } from "./store.js";

const USER = /^<@!?(\d{15,25})>$/;

function targetOf(argument: string): string | null {
  const token = argument.trim().split(/\s+/)[0];
  if (!token) return null;
  const mention = USER.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

type Section = "affection" | "playful" | "rough" | "feelings" | "gestures";

// name, help section, the description from the spec, and how the line reads.
// `{a}` is whoever ran it and `{b}` is who they aimed it at.
const ACTIONS: [string, Section, string, string][] = [
  ["airkiss", "affection", "Airkiss someone.", "{a} blows {b} a kiss"],
  ["celebrate", "affection", "Celebrate with someone.", "{a} celebrates with {b}"],
  ["cuddle", "affection", "Cuddle someone.", "{a} cuddles {b}"],
  ["handhold", "affection", "Hold hands with someone.", "{a} holds hands with {b}"],
  ["happy", "affection", "Be happy with someone.", "{a} is happy with {b}"],
  ["hug", "affection", "Hug someone.", "{a} hugs {b}"],
  ["kiss", "affection", "Kiss someone.", "{a} kisses {b}"],
  ["love", "affection", "Love someone.", "{a} loves {b}"],
  ["nuzzle", "affection", "Nuzzle someone.", "{a} nuzzles {b}"],
  ["pat", "affection", "Pat someone.", "{a} pats {b}"],
  ["smile", "affection", "Smile at someone.", "{a} smiles at {b}"],
  ["wave", "affection", "Wave at someone.", "{a} waves at {b}"],
  ["wink", "affection", "Wink at someone.", "{a} winks at {b}"],
  ["yay", "affection", "Get excited around someone.", "{a} gets excited around {b}"],

  ["bite", "playful", "Bite someone.", "{a} bites {b}"],
  ["bleh", "playful", "Bleh at someone.", "{a} goes bleh at {b}"],
  ["drool", "playful", "Drool on someone.", "{a} drools over {b}"],
  ["lick", "playful", "Lick someone.", "{a} licks {b}"],
  ["nom", "playful", "Nibble someone.", "{a} nibbles {b}"],
  ["nyah", "playful", "Nyahhh", "{a} nyahs at {b}"],
  ["peek", "playful", "Peek at someone.", "{a} peeks at {b}"],
  ["pinch", "playful", "Pinch someone.", "{a} pinches {b}"],
  ["poke", "playful", "Poke someone.", "{a} pokes {b}"],
  ["smug", "playful", "Smug at someone.", "{a} looks smug at {b}"],
  ["tickle", "playful", "Tickle someone.", "{a} tickles {b}"],
  ["woah", "playful", "Gasps at someone.", "{a} gasps at {b}"],

  ["angrystare", "rough", "Stare angrily at someone.", "{a} stares angrily at {b}"],
  ["evillaugh", "rough", "Laugh evilly at someone.", "{a} laughs evilly at {b}"],
  ["headbang", "rough", "Headbang into someone.", "{a} headbangs into {b}"],
  ["mad", "rough", "Get mad at someone.", "{a} is mad at {b}"],
  ["punch", "rough", "Punch someone.", "{a} punches {b}"],
  ["shout", "rough", "Shout at someone.", "{a} shouts at {b}"],
  ["slap", "rough", "Slap someone.", "{a} slaps {b}"],
  ["smack", "rough", "Smack someone.", "{a} smacks {b}"],

  ["confused", "feelings", "Act confused at someone.", "{a} is confused by {b}"],
  ["cry", "feelings", "Cry at someone.", "{a} cries at {b}"],
  ["facepalm", "feelings", "Facepalm at someone.", "{a} facepalms at {b}"],
  ["nervous", "feelings", "Get nervous around someone.", "{a} gets nervous around {b}"],
  ["pout", "feelings", "Pout at someone.", "{a} pouts at {b}"],
  ["sad", "feelings", "Is sad because of", "{a} is sad because of {b}"],
  ["scared", "feelings", "Get scared of someone.", "{a} is scared of {b}"],
  ["shrug", "feelings", "Shrug at someone.", "{a} shrugs at {b}"],
  ["shy", "feelings", "Get shy around someone.", "{a} gets shy around {b}"],
  ["sigh", "feelings", "Sigh at someone.", "{a} sighs at {b}"],
  ["sleep", "feelings", "Sleep with someone.", "{a} falls asleep on {b}"],
  ["sneeze", "feelings", "Sneeze on someone.", "{a} sneezes on {b}"],
  ["sorry", "feelings", "Be sorry to someone.", "{a} says sorry to {b}"],
  ["surprised", "feelings", "Act surprised at someone.", "{a} is surprised by {b}"],
  ["sweat", "feelings", "Sweat around someone.", "{a} sweats around {b}"],
  ["tired", "feelings", "Get tired around someone.", "{a} gets tired around {b}"],
  ["yawn", "feelings", "Yawn at someone.", "{a} yawns at {b}"],

  ["brofist", "gestures", "Bro fist someone.", "{a} bro fists {b}"],
  ["cheers", "gestures", "Cheer with someone.", "{a} raises a glass to {b}"],
  ["clap", "gestures", "Clap at someone.", "{a} claps for {b}"],
  ["cool", "gestures", "Cool with someone.", "{a} is being cool with {b}"],
  ["dance", "gestures", "Dance with someone.", "{a} dances with {b}"],
  ["laugh", "gestures", "Laugh with someone.", "{a} laughs with {b}"],
  ["sip", "gestures", "Sip something with someone.", "{a} sips something with {b}"],
  ["slowclap", "gestures", "Slow clap at someone.", "{a} slow claps at {b}"],
  ["stare", "gestures", "Stare at someone.", "{a} stares at {b}"],
  ["thumbsup", "gestures", "Give a thumbs up to someone.", "{a} gives {b} a thumbs up"],
  ["yes", "gestures", "Say yes to someone.", "{a} says yes to {b}"],
];

export const ACTION_COUNT = ACTIONS.length;

// Both names render as names either way; allowed_mentions is what decides who is
// actually pinged, so the target hears about it and the sender is not pinged for
// their own command.
function say(line: string, gif: string | null, ping: string[]) {
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { users: ping },
    components: [
      container(null, ...(gif ? [text(line), gallery({ url: gif })] : [text(line)])),
    ],
  };
}

function action(name: string, template: string) {
  return async (ctx: PrefixContext): Promise<void> => {
    if (!ctx.guildId) {
      await ctx.reply(notice("These only work in a server."));
      return;
    }
    if (!(await enabled(ctx.guildId))) {
      await ctx.reply(
        notice(
          [
            "Roleplay commands are off here.",
            "",
            "-# An administrator can turn them on with `roleplay enable`.",
          ].join("\n"),
        ),
      );
      return;
    }

    const target = targetOf(ctx.argument);
    if (!target) {
      await ctx.reply(notice([`Who are you aiming that at?`, "", `-# \`${name} @member\``].join("\n")));
      return;
    }

    const self = target === ctx.authorId;
    const line = template
      .replace("{a}", `<@${ctx.authorId}>`)
      .replace("{b}", self ? "themselves" : `<@${target}>`);

    const gif = await gifFor(name);
    // Nothing to ping when somebody aims one of these at themselves.
    await ctx.reply(say(self ? `${line}\n-# alright then` : line, gif, self ? [] : [target]));
  };
}

function notice(body: string) {
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [container(null, text(body))],
  };
}

export function registerActions(): void {
  const sections = new Set(ACTIONS.map(([, section]) => section));
  for (const section of sections) {
    inCategory(section, () => {
      for (const [name, its, description, template] of ACTIONS) {
        if (its !== section) continue;
        register({ name, description, handler: action(name, template) });
      }
    });
  }
}
