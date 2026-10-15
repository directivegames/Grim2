declare module 'gltf-validator' {
  export function validateBytes(bytes: Uint8Array): Promise<unknown>;
}
