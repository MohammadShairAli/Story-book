/**
 * Words for young readers: what to do on each page, and what the page
 * buttons do from where the book currently is.
 */

import { SOUNDS, type SoundId } from "./sounds";
import { BACK_STOP, FIRST_STOP, POCKET_STOP } from "./timeline";

export type Hint = {
  text: string;
  /** When set, the hint shows this sound button's decal, so it can be matched to the book. */
  sound?: SoundId;
  icon?: "open" | "pocket" | "end";
};

const SOUND_HINTS: Record<SoundId, string> = {
  crowd: "Press the crowd button to hear the fans chatting.",
  whistle: "Press the whistle button to hear the referee start the match.",
  stadium: "Press the stadium button to hear the whole stadium roar.",
  aaah: "Press the Aaah button when everyone holds their breath.",
  ole: "Press the Olé button to chant along with the fans.",
  rec: "Press the Rec button to record your own match-day sound.",
};

export function hintAt(stop: number): Hint {
  if (stop <= FIRST_STOP) {
    return { icon: "open", text: "Press “Open the book” to start the story." };
  }
  if (stop === POCKET_STOP) {
    return {
      icon: "pocket",
      text: "You can put your game ticket in this pocket, or add your favourite photo.",
    };
  }
  if (stop >= BACK_STOP) {
    return { icon: "end", text: "That’s the end of the match! Press “Start again” to read it once more." };
  }

  const sound = (Object.keys(SOUNDS) as SoundId[]).find((id) => SOUNDS[id].page === stop);
  return sound ? { sound, text: SOUND_HINTS[sound] } : { text: "Press “Next page” to keep reading." };
}

/** Kept short enough that both labels fit side by side on a phone. */
export function nextLabel(stop: number) {
  if (stop === FIRST_STOP) return "Open the book";
  if (stop === POCKET_STOP - 1) return "Open the pocket";
  if (stop === POCKET_STOP) return "Turn over";
  return "Next page";
}

export function previousLabel(stop: number) {
  if (stop === FIRST_STOP + 1) return "Close the book";
  if (stop === POCKET_STOP) return "Close the pocket";
  if (stop === BACK_STOP) return "Turn back";
  return "Previous page";
}
