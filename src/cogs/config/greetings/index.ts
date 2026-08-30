import { onBoost, onMemberJoin, onMemberLeave } from "../../../core/hooks.js";
import { postGreeting, registerGreeting } from "./messages.js";

export const BOOST = "boost";

export const WELCOME = "welcome";

export const GOODBYE = "goodbye";

export function registerWelcome(): void {
  onMemberJoin(async (event) => {
    await postGreeting(WELCOME, event.guildId, event.userId);
  });

  registerGreeting({
    kind: WELCOME,
    command: "welcome",
    aliases: ["welcomemsg", "greet"],
    heading: "Welcome messages",
    description: "Post a message when someone joins",
    when: "when someone joins",
    note: "Needs a system channel with join messages enabled, or the GuildMembers intent.",
  });
}

export function registerGoodbye(): void {
  onMemberLeave(async (event) => {
    await postGreeting(GOODBYE, event.guildId, event.userId);
  });

  registerGreeting({
    kind: GOODBYE,
    command: "goodbye",
    aliases: ["goodbyemsg", "leave"],
    heading: "Goodbye messages",
    description: "Post a message when someone leaves",
    when: "when someone leaves",
    note: "Discord sends no message when a member leaves, so this needs the GuildMembers intent.",
  });
}

export function registerBoostMessages(): void {
  onBoost(async (event) => {
    await postGreeting(BOOST, event.guildId, event.userId);
  });

  registerGreeting({
    kind: BOOST,
    command: "boosts",
    aliases: ["boostmsg", "boostmessage"],
    heading: "Boost messages",
    description: "Post a message when someone boosts",
    when: "when someone boosts",
    note: "Discord only announces a boost if the server has a system channel with boost messages enabled.",
  });
}
