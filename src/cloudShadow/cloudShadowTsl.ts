/**
 * World-space tri-planar cloud shadow multiplier (TSL).
 */
import {
  abs,
  float,
  max,
  normalWorld,
  positionWorld,
  smoothstep,
  sub,
  vec2,
} from 'three/tsl';

import { CloudShadowState } from './CloudShadowState.js';

import type { Node } from 'three/webgpu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cachedMultiplier: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLayer(scaleMul: any, speedMul: any) {
  const scale = CloudShadowState.uCloudScale.mul(scaleMul);
  const wind = CloudShadowState.uWindDir;
  const scroll = wind.mul(CloudShadowState.uTime).mul(CloudShadowState.uCloudSpeed).mul(speedMul);
  const windOrtho = vec2(wind.y, wind.x.negate());

  const n = abs(normalWorld);
  const wSum = max(n.x.add(n.y).add(n.z), float(0.0001));
  const blend = n.div(wSum);

  const uvX = positionWorld.yz.mul(scale).add(scroll);
  const uvY = positionWorld.xz.mul(scale).add(scroll);
  const uvZ = positionWorld.xy.mul(scale).add(
    windOrtho.mul(CloudShadowState.uTime).mul(CloudShadowState.uCloudSpeed).mul(speedMul),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const texMap = CloudShadowState.uCloudMap as any;
  const sX = texMap.uv(uvX).r;
  const sY = texMap.uv(uvY).r;
  const sZ = texMap.uv(uvZ).r;

  return sX.mul(blend.x).add(sY.mul(blend.y)).add(sZ.mul(blend.z));
}

/** Shared node graph — multiply outgoing diffuse/lighting by this factor. */
export function getCloudShadowMultiplierNode(): Node {
  if (_cachedMultiplier) {
    return _cachedMultiplier as Node;
  }

  const cloud1 = buildLayer(float(1), float(1));
  const cloud2 = buildLayer(CloudShadowState.uLayer2ScaleMul, CloudShadowState.uLayer2SpeedMul);
  const cloudMask = cloud1.mul(float(0.7)).add(cloud2.mul(float(0.3)));
  const softened = smoothstep(CloudShadowState.uCloudLow, CloudShadowState.uCloudHigh, cloudMask);
  const shadowAmount = softened.mul(CloudShadowState.uShadowStrength).mul(CloudShadowState.uEnabled);

  _cachedMultiplier = sub(float(1), shadowAmount);
  return _cachedMultiplier as Node;
}

export function invalidateCloudShadowTslCache(): void {
  _cachedMultiplier = null;
}

export interface CloudShadowColorNode {
  mul: (other: Node) => Node;
}

export function multiplyColorByCloudShadow(baseColor: CloudShadowColorNode): Node {
  return baseColor.mul(getCloudShadowMultiplierNode());
}
