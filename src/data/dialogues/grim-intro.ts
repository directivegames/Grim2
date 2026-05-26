import type { DialogueScript } from '../../dialogue/DialogueTypes.js';

/** Grim's Room intro — intercom briefing before the Burdenville map. */
export const GRIM_INTRO_DIALOGUE: DialogueScript = [
  { speaker: 'Intercom', text: 'Hello, sir. Sorry to bother you on your day off.' },
  { speaker: 'Grim', text: 'What is it?' },
  { speaker: 'Intercom', text: 'There is an apocalyptic-grade event happening, and you are being called in to help.' },
  { speaker: 'Grim', text: "Don't tell me…" },
  { speaker: 'Intercom', text: "Okay… psst He said not to tell him what we're going to tell C-Suit now." },
  { speaker: 'Grim', text: 'Argh, tell me.' },
  { speaker: 'Intercom', text: "Oh, right. Well… a bunch of souls from the, you know, slightly disturbed area of the underworld have escaped." },
  { speaker: 'Grim', text: 'Burdenville.' },
  { speaker: 'Intercom', text: 'Burdenville.' },
  { speaker: 'Grim', text: 'Whose idea was it to put a hole to the underworld there?' },
  { speaker: 'Intercom', text: 'I believe it was their mayor in 1678. He was a big fan of yours.' },
  { speaker: 'Grim', text: 'So, is C-Suit asking for reaping, then?' },
  { speaker: 'Intercom', text: 'Yes. The souls have escaped and, you know, taken over the bodies of the dead and things.' },
  { speaker: 'Grim', text: 'Great. And I guess they blame me for this?' },
  { speaker: 'Intercom', text: "Well, you know they don't like you taking days off, sir. I mean, death doesn't stop." },
  { speaker: 'Grim', text: "Fine. I'll go and reap the souls back." },
  { speaker: 'Intercom', text: "Thank you. C-Suit will be pleased. However, be careful. They're quite angry about it, and they don't want a lot of, say, collateral damage, so to speak." },
  { speaker: 'Grim', text: "Of course. It's all they care about — their image." },
  { speaker: 'Intercom', text: 'Thank you, sir.' },
  { speaker: 'Grim', text: "Right, let's take a look at the map of Burdenville and see where we're going." },
];
