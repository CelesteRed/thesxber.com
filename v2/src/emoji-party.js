import { API_NOTES } from "../shared/api-notes.js";

export function installEmojiParty(host, onActivate) {
  let active = true;
  // Functions require an explicit call; DevTools autocomplete cannot start motion.
  const partyTime = () => {
    if (!active) return;
    host.console.log(API_NOTES);
    onActivate();
  };
  const names = ["partyTime", "party time", "Party Time"];
  const previous = new Map();
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(host, name);
    if (descriptor && !descriptor.configurable) continue;
    previous.set(name, descriptor);
    Object.defineProperty(host, name, { configurable: true, writable: true, value: partyTime });
  }
  const timer = host.setTimeout(() => {
    host.console.log("Type 'party time' for a fun time!");
    host.console.log('Run partyTime() or window["Party Time"]()');
  }, 5 * 60 * 1000);

  return () => {
    active = false;
    host.clearTimeout(timer);
    for (const [name, descriptor] of previous) {
      if (Object.getOwnPropertyDescriptor(host, name)?.value !== partyTime) continue;
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else delete host[name];
    }
  };
}
