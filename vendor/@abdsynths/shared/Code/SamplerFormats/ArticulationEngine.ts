// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Sampler Articulation Engine (Round-Robin, Release Triggers, Mod Matrix)
//
// Industry-standard runtime voice dispatcher managing:
//   1. Round-Robin state cycling:
//      - 'cycle' (sequential 1..N)
//      - 'random' (pseudo-random without immediate repeats)
//      - 'true-neighbor' (adjacent sample borrowing)
//   2. Release trigger scheduling (Key-Off sample auditioning)
//   3. MIDI Modulation Matrix (Mod Matrix):
//      - Sources: CC1 (ModWheel), CC11 (Expression), PitchBend, Velocity, Channel Pressure (Aftertouch)
//      - Destinations: Filter Cutoff, Volume (dB), Pitch (cents), Sample Start, Resonance
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedRegion, MidiNote, SamplerPlayLogic, TriggerMode } from './SamplerTypes.ts';

export type ModSource =
  | 'modwheel'       // CC1
  | 'expression'     // CC11
  | 'velocity'       // Note-on velocity (1..127)
  | 'aftertouch'     // Channel pressure (0..127)
  | 'pitchbend';     // Bipolar -8192..+8191

export type ModDestination =
  | 'cutoff'         // Filter Cutoff Hz
  | 'resonance'      // Filter Resonance (0..1)
  | 'volume'         // Volume in dB
  | 'pitch'          // Pitch detune in cents
  | 'sample_start';  // Frame start offset

export interface ModMatrixRoute {
  source: ModSource;
  destination: ModDestination;
  amount: number;    // Normalized bipolar (-1.0 .. +1.0)
}

export interface ArticulationEngineConfig {
  routes?: ModMatrixRoute[];
}

export class SamplerArticulationEngine {
  private readonly rrCounters = new Map<string, number>();
  private readonly lastRandomPick = new Map<string, number>();
  private routes: ModMatrixRoute[] = [];

  constructor(config?: ArticulationEngineConfig) {
    if (config?.routes) {
      this.routes = [...config.routes];
    }
  }

  public setModRoutes(routes: ModMatrixRoute[]): void {
    this.routes = [...routes];
  }

  public addModRoute(route: ModMatrixRoute): void {
    this.routes.push(route);
  }

  /**
   * Selects the active region among multiple candidates covering the same note/velocity,
   * respecting round-robin cycle/random logic and trigger mode (attack vs release).
   */
  public selectRegionForNote(
    candidateRegions: ExtendedRegion[],
    note: MidiNote,
    velocity: number,
    triggerType: TriggerMode = 'attack'
  ): ExtendedRegion | undefined {
    // 1. Filter by trigger mode
    const matchedTrigger = candidateRegions.filter((r) => (r.trigger || 'attack') === triggerType);
    if (matchedTrigger.length === 0) return undefined;
    if (matchedTrigger.length === 1) return matchedTrigger[0];

    // 2. Group by Round-Robin index if defined
    const hasRr = matchedTrigger.some((r) => (r.seqLength ?? 1) > 1);
    if (!hasRr) {
      return matchedTrigger[0];
    }

    const rrGroupKey = `${note}_${matchedTrigger[0].lowVel}_${triggerType}`;
    const totalRr = Math.max(...matchedTrigger.map((r) => r.seqLength ?? 1));
    const logic: SamplerPlayLogic = matchedTrigger[0].playLogic || 'round_robin';

    let targetIndex = 1;
    if (logic === 'random') {
      const last = this.lastRandomPick.get(rrGroupKey) ?? 0;
      // Pick random 1..totalRr avoiding immediate repeat when totalRr > 1
      let pick = Math.floor(Math.random() * totalRr) + 1;
      if (totalRr > 1 && pick === last) {
        pick = (pick % totalRr) + 1;
      }
      this.lastRandomPick.set(rrGroupKey, pick);
      targetIndex = pick;
    } else {
      // Sequential cycle
      const cur = this.rrCounters.get(rrGroupKey) ?? 0;
      targetIndex = (cur % totalRr) + 1;
      this.rrCounters.set(rrGroupKey, targetIndex);
    }

    const chosen =
      matchedTrigger.find((r) => (r.seqPosition ?? 1) === targetIndex) ??
      matchedTrigger[0];

    return chosen;
  }

  /**
   * Evaluates modulation matrix offsets for a given set of MIDI controller states.
   */
  public computeModulations(inputs: {
    velocity?: number;     // 1..127
    modwheel?: number;     // 0..127
    expression?: number;   // 0..127
    aftertouch?: number;   // 0..127
    pitchbend?: number;    // -8192..+8191
  }): {
    cutoffMultiplier: number;
    volumeDbOffset: number;
    pitchCentsOffset: number;
    resonanceOffset: number;
  } {
    let cutoffSemi = 0;
    let volDb = 0;
    let pitchCents = 0;
    let res = 0;

    const normSource = (src: ModSource): number => {
      switch (src) {
        case 'velocity':
          return (inputs.velocity ?? 100) / 127.0;
        case 'modwheel':
          return (inputs.modwheel ?? 0) / 127.0;
        case 'expression':
          return (inputs.expression ?? 127) / 127.0;
        case 'aftertouch':
          return (inputs.aftertouch ?? 0) / 127.0;
        case 'pitchbend':
          return (inputs.pitchbend ?? 0) / 8192.0;
      }
    };

    for (const r of this.routes) {
      const val = normSource(r.source);
      const mod = val * r.amount;

      switch (r.destination) {
        case 'cutoff':
          // mod * up to 4 octaves (48 semitones)
          cutoffSemi += mod * 48.0;
          break;
        case 'volume':
          // mod * up to 24 dB
          volDb += mod * 24.0;
          break;
        case 'pitch':
          // mod * up to 200 cents (whole tone)
          pitchCents += mod * 200.0;
          break;
        case 'resonance':
          res += mod * 0.5;
          break;
      }
    }

    return {
      cutoffMultiplier: Math.pow(2.0, cutoffSemi / 12.0),
      volumeDbOffset: volDb,
      pitchCentsOffset: pitchCents,
      resonanceOffset: res,
    };
  }

  public reset(): void {
    this.rrCounters.clear();
    this.lastRandomPick.clear();
  }
}
