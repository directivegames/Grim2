/** GameAudioManager keys for Postman boss taunt lines. */
export const POSTMAN_VOICE_LINE_KEYS = [
  'postmanDebt',
  'postmanMama',
  'postmanOwnadog',
  'postmanLine',
  'postmanXmascard',
] as const;

export type PostmanVoiceLineKey = (typeof POSTMAN_VOICE_LINE_KEYS)[number];

export const POSTMAN_VOICE_MIN_INTERVAL_SEC = 9;
export const POSTMAN_VOICE_MAX_INTERVAL_SEC = 17;

export function pickRandomPostmanVoiceLine(): PostmanVoiceLineKey {
  const idx = Math.floor(Math.random() * POSTMAN_VOICE_LINE_KEYS.length);
  return POSTMAN_VOICE_LINE_KEYS[idx] ?? 'postmanLine';
}

export function rollPostmanVoiceIntervalSec(): number {
  const span = POSTMAN_VOICE_MAX_INTERVAL_SEC - POSTMAN_VOICE_MIN_INTERVAL_SEC;
  return POSTMAN_VOICE_MIN_INTERVAL_SEC + Math.random() * span;
}
