export const EMOJI_UNLOCK_COOKIE = "sxber-emoji-unlocked";

export function hasEmojiUnlock(cookie = "") {
  return cookie.split(";").some(part => part.trim() === `${EMOJI_UNLOCK_COOKIE}=1`);
}

export function emojiUnlockCookie(secure = false) {
  return `${EMOJI_UNLOCK_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// Shared across spawned emojis so fading/replacing an image does not reset clicks.
export function createEmojiUnlockTracker(onUnlock, alreadyUnlocked = false) {
  let unlocked = alreadyUnlocked;
  const counts = { click: 0, hover: 0, drag: 0 };
  return (interaction) => {
    if (unlocked) return;
    if (!Object.hasOwn(counts, interaction) || ++counts[interaction] < 10) return;
    unlocked = true;
    onUnlock();
  };
}
