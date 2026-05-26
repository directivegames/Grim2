/**
 * Shared dialogue types — extend fields later (portrait, voiceClip, branches).
 */
export type DialogueLine = {
  speaker: string;
  text: string;
  portrait?: string;
  voiceClip?: string;
};

export type DialogueScript = readonly DialogueLine[];
