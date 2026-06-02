/** Temporary diagnostics for mission reset / spawn — filter console by `[MissionReset]`. */
export function logMissionReset(phase: string, detail: Record<string, unknown> = {}): void {
  console.info(`[MissionReset] ${phase}`, detail);
}
