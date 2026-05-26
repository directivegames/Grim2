import type { DialogueScript } from '../dialogue/DialogueTypes.js';
import { GRIM_INTRO_DIALOGUE } from './dialogues/grim-intro.js';

/**
 * Registry of dialogue scripts by id — add new files under dialogues/ and register here.
 * Future DialogueTriggerActor instances reference these ids.
 */
export const DIALOGUE_SCRIPTS = {
  'grim-intro': GRIM_INTRO_DIALOGUE,
} as const;

export type DialogueScriptId = keyof typeof DIALOGUE_SCRIPTS;

export function getDialogueScript(id: DialogueScriptId): DialogueScript {
  return DIALOGUE_SCRIPTS[id];
}
