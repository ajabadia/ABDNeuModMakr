/** @abdsynths/contracts — tipos del registro de tablas LUT de firmware */

export interface LutProvenance {
  firmware?: string;
  romOffset?: string;
  dspAddress?: string;
  wordFormat?: string;
  crossCheckedWith?: string[];
}

export interface LutTable {
  readonly id: string;
  readonly unit: string | null;
  readonly length: number;
  readonly values: readonly number[];
  readonly provenance: LutProvenance | null;
}

export declare class LutNotFoundError extends Error {
  constructor(lutId: string);
  lutId: string;
}

export declare function listLutIds(): string[];
export declare function hasLut(lutId: string): boolean;
export declare function getLut(lutId: string): LutTable;
export declare function getLutValues(lutId: string): readonly number[];
export declare function lutValueAt(lutId: string, t: number): number;
export declare function lutNormalizedForValue(lutId: string, value: number): number;
