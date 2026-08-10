/**
 * DialogueTriggerActor — place in a scene to play a registered dialogue script.
 *
 * Set dialogueId to a key from dialogue-registry.ts. Trigger when the player
 * enters range (future) or call triggerDialogue() from code.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { DialogueScriptId } from '../data/dialogue-registry.js';
import { getDialogueScript } from '../data/dialogue-registry.js';
import { DialogueUI } from '../ui/DialogueUI.js';

@ENGINE.GameClass()
export class DialogueTriggerActor extends ENGINE.Actor {

  @ENGINE.property({ type: 'string', category: 'Dialogue' })
  public dialogueId: DialogueScriptId = 'grim-intro';

  @ENGINE.property({ type: 'boolean', category: 'Dialogue' })
  public playOnBeginPlay = false;

  private _played = false;

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }if (this.playOnBeginPlay && !this._played) {
      void this.triggerDialogue();
    }
  
    return true;
  }

  /** Play this actor's dialogue script once. */
  public async triggerDialogue(): Promise<void> {
    if (this._played) return;

    const world = this.getWorld();
    if (!world) return;

    const script = getDialogueScript(this.dialogueId);
    this._played = true;
    await DialogueUI.play(world, script);
  }

  public resetDialogue(): void {
    this._played = false;
  }
}
