/**
 * Contract for the `editor` variable injected into every `evalWorld` script.
 * Use this instead of reaching for `sceneStore` or `editorStore` directly.
 */

import type { Actor } from '../actors/Actor.js';
import type { SceneComponent } from '../components/SceneComponent.js';
import type { World } from '../game/World.js';

/** Project asset types recognised by the editor. */
export type IEditorAssetType =
  | 'model'
  | 'texture'
  | 'hdri'
  | 'video'
  | 'audio'
  | 'json'
  | 'scene'
  | 'prefab'
  | 'material'
  | 'resource'
  | 'sourcecode'
  | 'jsclass'
  | 'mesh-combination'
  | 'lightmap'
  | 'navmesh'
  | 'vfx'
  | 'animconfig'
  | 'skeletonprofile';

/** World-space transform for spawning. Uses plain numbers, not THREE types. */
export interface IActorSpawnTransform {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
}

/** Axis-aligned bounding box of an asset in its local space. All values in world units. */
export interface IAssetBounds {
  /** Width (x), height (y), depth (z) of the bounding box. */
  size: { x: number; y: number; z: number };
  /** Centre of the bounding box. */
  center: { x: number; y: number; z: number };
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Node types present in the scene outliner. */
export type IOutlinerNodeType = 'scene' | 'folder' | 'actor';

/** A single node in the scene outliner tree, as returned by {@link IEditorContext.getOutlinerState}. */
export interface IOutlinerNode {
  /** Unique identifier (UUID for actors, generated ID for folders, fixed ID for the scene root). */
  id: string;
  /** Display name shown in the outliner. */
  name: string;
  /** Type of this node. */
  nodeType: IOutlinerNodeType;
  /** ID of the parent node, or `null` for the scene root. */
  parentId: string | null;
  /** IDs of direct children, in outliner order. */
  childIds: string[];
}

export interface IEditorContext {
  /** Returns the active world, or `null` if none is loaded. */
  getWorld(): World | null;

  /**
   * Adds an already-instantiated actor to the active world.
   * Returns `null` if no world is loaded.
   *
   * Use `ClassName.create(options)` to instantiate actors and components —
   * it calls `initialize()` internally and is the idiomatic factory pattern.
   *
   * @example Simple actor (bare SceneComponent root)
   * ```ts
   * const actor = ENGINE.Actor.create({ name: 'MyActor' });
   * editor.addActorToWorld(actor);
   * ```
   *
   * @example Actor with a MeshComponent as its root
   * ```ts
   * const mesh = ENGINE.MeshComponent.create({
   *   geometry: new THREE.SphereGeometry(0.5, 32, 32),
   *   material: new THREE.MeshStandardMaterial({ color: 0xff0000 }),
   * });
   * const actor = ENGINE.Actor.create({ rootComponent: mesh, name: 'RedBall' });
   * editor.addActorToWorld(actor);
   * ```
   *
   * @example Actor with multiple child components under the root
   * ```ts
   * const mesh = ENGINE.MeshComponent.create({
   *   geometry: new THREE.BoxGeometry(1, 1, 1),
   *   material: new THREE.MeshStandardMaterial({ color: 0x00aaff }),
   * });
   * const light = ENGINE.PointLightComponent.create({ color: 0xffffff, intensity: 2 });
   * light.position.set(0, 1, 0);
   * const actor = ENGINE.Actor.create({ rootComponent: mesh, sceneComponents: [light], name: 'LitBox' });
   * editor.addActorToWorld(actor);
   * ```
   */
  addActorToWorld(actor: Actor): Actor | null;

  /**
   * Spawns a prefab instance by asset path. Fetches the prefab from storage if
   * not already cached. Returns `null` if the world is inactive or the prefab
   * fails to load.
   *
   * @example
   * ```ts
   * const actor = await editor.addPrefabToWorld(
   *   '@project/assets/prefabs/HealthPickup.prefab.json',
   *   { position: { x: 0, y: 1, z: 0 } },
   *   'HealthPickup_1',
   * );
   * ```
   */
  addPrefabToWorld(prefabPath: string, transform?: IActorSpawnTransform, name?: string): Promise<Actor | null>;

  /** Removes one or more actors from the world. */
  deleteActors(...actors: Actor[]): void;

  /** Returns the primary selected actor, or `null` if nothing is selected. */
  getSelectedActor(): Actor | null;

  /** Returns all non-transient actors in the world. */
  listActors(): Actor[];

  /** Finds the first actor whose name matches exactly. */
  getActorByName(name: string): Actor | null;

  /** Finds an actor by its UUID. */
  getActorByUuid(uuid: string): Actor | null;

  /** Finds a component by its UUID, searching all actors in the world. */
  getComponentByUuid(uuid: string): SceneComponent | null;

  /**
   * Returns the axis-aligned bounding box of a `model` or `prefab` asset in
   * its local space. Useful for calculating ground-placement offsets or scale
   * checks before calling `addPrefabToWorld`.
   *
   * Returns `null` if the asset cannot be loaded or has no geometry.
   *
   * @example
   * ```ts
   * const bounds = await editor.getAssetBounds('@project/assets/prefabs/Crate.prefab.json');
   * // Place the crate so its base sits on y = 0
   * const y = bounds ? bounds.size.y / 2 - bounds.center.y : 0;
   * await editor.addPrefabToWorld('@project/assets/prefabs/Crate.prefab.json', { position: { x: 0, y, z: 0 } });
   * ```
   */
  getAssetBounds(assetPath: string): Promise<IAssetBounds | null>;

  /**
   * Returns all project asset paths of the given type.
   *
   * @example
   * ```ts
   * const prefabs = editor.listAssets('prefab');
   * // → ['@project/assets/prefabs/Cube.prefab.json', ...]
   * ```
   */
  listAssets(type: IEditorAssetType): string[];

  /**
   * Looks up a direct child folder of `parentId` (or root if omitted) by name.
   * Creates it if no match is found. Safe to call repeatedly — returns the same
   * ID on every call when the folder already exists.
   *
   * @param name - Display name to look up or create.
   * @param parentId - Optional ID of the parent folder. Defaults to the scene root.
   * @returns The ID of the found or newly created folder, or `null` if the operation failed.
   *
   * @example
   * ```ts
   * // Idempotent: always returns the same ID for 'Lights'
   * const folderId = editor.ensureFolder('Lights');
   *
   * // Nested folder
   * const parentId = editor.ensureFolder('Environment');
   * const childId  = editor.ensureFolder('Foliage', parentId!);
   * ```
   */
  ensureFolder(name: string, parentId?: string): string | null;

  /**
   * Renames an existing folder.
   * Returns `true` on success, `false` if the folder was not found.
   *
   * @param folderId - ID of the folder to rename.
   * @param newName - New display name.
   *
   * @example
   * ```ts
   * editor.renameFolder(folderId, 'VFX');
   * ```
   */
  renameFolder(folderId: string, newName: string): boolean;

  /**
   * Deletes a folder from the scene outliner.
   *
   * @param folderId - ID of the folder to delete.
   * @param deleteContents - When `true` (default), recursively deletes all child
   *   folders and their actors. When `false`, child nodes are reparented to the
   *   deleted folder's parent before removal.
   * @returns `true` on success, `false` if the folder was not found.
   *
   * @example
   * ```ts
   * // Delete folder and all its contents
   * editor.deleteFolder(folderId);
   *
   * // Dissolve folder, keeping actors in place
   * editor.deleteFolder(folderId, false);
   * ```
   */
  deleteFolder(folderId: string, deleteContents?: boolean): boolean;

  /**
   * Moves an actor to a different parent in the scene outliner.
   * Pass a folder ID to nest the actor inside a folder, or `null` to move it
   * back to the scene root.
   *
   * @param actorId - UUID of the actor to move.
   * @param targetId - ID of the target folder, or `null` to reparent to the scene root.
   * @returns `true` on success, `false` if the actor or target was not found.
   *
   * @example
   * ```ts
   * const folderId = editor.ensureFolder('Lights');
   * editor.reparentActor(sunLightId, folderId);
   *
   * // Move back to root
   * editor.reparentActor(sunLightId, null);
   * ```
   */
  reparentActor(actorId: string, targetId: string | null): boolean;

  /**
   * Returns a flat snapshot of every node in the scene outliner (scene root,
   * folders, and actors), each with its parent and child IDs for hierarchy
   * traversal. Returns an empty array if no world is loaded.
   *
   * @returns Array of {@link IOutlinerNode} objects in depth-first order.
   *
   * @example
   * ```ts
   * const nodes = editor.getOutlinerState();
   * // → [
   * //   { id: 'root',     name: 'Scene',    nodeType: 'scene',  parentId: null,     childIds: ['folder-1', 'actor-1'] },
   * //   { id: 'folder-1', name: 'Lights',   nodeType: 'folder', parentId: 'root',   childIds: ['actor-2'] },
   * //   { id: 'actor-2',  name: 'SunLight', nodeType: 'actor',  parentId: 'folder-1', childIds: [] },
   * //   { id: 'actor-1',  name: 'Cube',     nodeType: 'actor',  parentId: 'root',   childIds: [] },
   * // ]
   *
   * // Find all root-level actors (not inside a folder)
   * const root = nodes.find(n => n.nodeType === 'scene');
   * const rootActors = root?.childIds
   *   .map(id => nodes.find(n => n.id === id))
   *   .filter(n => n?.nodeType === 'actor');
   * ```
   */
  getOutlinerState(): IOutlinerNode[];
}
