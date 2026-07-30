import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/**
 * Clears obsolete entity-root flags from children restored out of pre-unified
 * Actor scene data. The Actor itself is now the only entity root.
 */
export function normalizeLegacyActorHierarchy(actor: ENGINE.Actor): void {
  for (const node of actor.getNodes(THREE.Object3D)) {
    if (node !== actor) {
      node.setFlags(ENGINE.ObjectFlags.DefaultSubObject);
    }
  }
}
