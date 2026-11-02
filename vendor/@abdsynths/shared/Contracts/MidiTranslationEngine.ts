/**
 * @abdsynths/contracts — MidiTranslationEngine (v2.0)
 *
 * Motor universal de traducción impulsado por esquema (Common Data Dictionary) entre:
 *   - Valores normalizados [0,1] <-> Dominio físico DSP (Hz, s, ms, dB, st, cents, BPM, %, pan)
 *   - Valores Wire (MIDI CC 0-127, NRPN, SysEx, Bipolar con centro hardware) <-> Dominio físico
 *   - Búsqueda por ID de parámetro o por rol semántico transversal (`semanticRole`)
 *
 * Compatible con todos los contratos `*_parameter_spec.json` y `sampler_voice_parameter_spec.json`
 * definidos bajo `parameter_dictionary.schema.json`.
 */

export type CurveType = 'Linear' | 'Exp' | 'Pow' | 'SymBipolar' | 'PiecewiseLinear' | 'Lut' | 'None';

export type ParameterScope = 'global' | 'part' | 'group' | 'zone' | 'loop' | 'mod_slot';

export interface ParameterMeta {
  id: string;
  name?: string;
  group?: string;
  scope?: ParameterScope;
  semanticRole?: string;
  type?: 'continuous' | 'bipolar' | 'integer' | 'choice' | 'boolean' | 'discrete';
  min?: number;
  max?: number;
  default?: number;
  wire: 'CC' | 'None' | 'SysEx' | 'Nrpn';
  wireCodec: 'Value' | 'Bipolar' | 'Enum' | 'SignedByte' | 'Bitfield';
  wireZeroCenter?: number;
  curve: CurveType;
  curveP0?: number;
  curveP1?: number;
  lutId?: string;
  domainMin: number;
  domainMax: number;
  unit: string | null;
  smoothing?: 'None' | 'Linear' | 'Log' | 'Logarithmic';
  choices?: string[];
  cc?: number | null;
  nrpnMsb?: number | null;
  nrpnLsb?: number | null;
  modDestId?: string | number | null;
}

export interface ParameterDictionarySpec {
  schemaVersion?: string | number;
  id?: string;
  synthName?: string;
  model?: string;
  displayName?: string;
  topology?: 'fixed' | 'multi_part' | 'hierarchical_sampler';
  parameters: Array<Partial<ParameterMeta> & { id: string }>;
}

export class MidiTranslationEngine {
  private static paramCache: Map<string, ParameterMeta> = new Map();
  private static roleCache: Map<string, ParameterMeta> = new Map();

  private readonly instanceCache: Map<string, ParameterMeta> = new Map();
  private readonly instanceRoleCache: Map<string, ParameterMeta> = new Map();

  constructor(spec?: ParameterDictionarySpec) {
    if (spec) {
      this.loadSpec(spec);
    }
  }

  /** Normaliza una entrada parcial de JSON al contrato completo ParameterMeta */
  public static normalizeEntry(raw: Partial<ParameterMeta> & { id: string }): ParameterMeta {
    const min = raw.min ?? 0;
    const max = raw.max ?? 1;
    const domainMin = raw.domainMin ?? min;
    const domainMax = raw.domainMax ?? max;
    const curve: CurveType = raw.curve ?? 'Linear';
    const p0 =
      raw.curveP0 !== undefined && raw.curveP0 > 0
        ? raw.curveP0
        : curve === 'Exp' && domainMin > 0
          ? domainMin
          : 1.0;
    const p1 =
      raw.curveP1 !== undefined && raw.curveP1 !== 0
        ? raw.curveP1
        : curve === 'Exp' && domainMin > 0 && domainMax > domainMin
          ? Math.log(domainMax / domainMin)
          : 1.0;

    return {
      id: raw.id,
      name: raw.name ?? raw.id,
      group: raw.group ?? 'General',
      scope: raw.scope ?? 'global',
      semanticRole: raw.semanticRole,
      type: raw.type ?? 'continuous',
      min,
      max,
      default: raw.default ?? min,
      wire: raw.wire ?? 'None',
      wireCodec: raw.wireCodec ?? 'Value',
      wireZeroCenter: raw.wireZeroCenter,
      curve,
      curveP0: p0,
      curveP1: p1,
      lutId: raw.lutId,
      domainMin,
      domainMax,
      unit: raw.unit ?? null,
      smoothing: raw.smoothing ?? 'Linear',
      choices: raw.choices,
      cc: raw.cc ?? null,
      nrpnMsb: raw.nrpnMsb ?? null,
      nrpnLsb: raw.nrpnLsb ?? null,
      modDestId: raw.modDestId ?? null,
    };
  }

  /** Carga un diccionario en la instancia y en la caché estática compartida */
  public loadSpec(spec: ParameterDictionarySpec): void {
    this.instanceCache.clear();
    this.instanceRoleCache.clear();
    for (const raw of spec.parameters) {
      const entry = MidiTranslationEngine.normalizeEntry(raw);
      this.instanceCache.set(entry.id, entry);
      MidiTranslationEngine.paramCache.set(entry.id, entry);
      if (entry.semanticRole) {
        this.instanceRoleCache.set(entry.semanticRole, entry);
        MidiTranslationEngine.roleCache.set(entry.semanticRole, entry);
      }
    }
  }

  public static loadDictionary(spec: ParameterDictionarySpec): void {
    this.paramCache.clear();
    this.roleCache.clear();
    for (const raw of spec.parameters) {
      const entry = this.normalizeEntry(raw);
      this.paramCache.set(entry.id, entry);
      if (entry.semanticRole) {
        this.roleCache.set(entry.semanticRole, entry);
      }
    }
  }

  /** Evalúa la conversión directa Normalizado [0,1] -> Dominio Físico */
  public static evalNormalizedToDomain(meta: ParameterMeta, tRaw: number): number {
    const t = Number.isFinite(tRaw) ? Math.max(0.0, Math.min(1.0, tRaw)) : 0.0;
    const { curve, domainMin, domainMax } = meta;
    const p0 = meta.curveP0 && meta.curveP0 > 0 ? meta.curveP0 : domainMin > 0 ? domainMin : 1.0;
    const p1 =
      meta.curveP1 && meta.curveP1 !== 0
        ? meta.curveP1
        : domainMin > 0 && domainMax > domainMin
          ? Math.log(domainMax / domainMin)
          : 1.0;

    let physical: number;
    switch (curve) {
      case 'Exp': {
        // Si p0 * exp(p1) coincide con el dominio físico (ej. 0.001 * exp(11.5129 * t) = 100 s
        // o 20 * exp(6.9077 * t) = 20000 Hz), la fórmula da directamente la magnitud física.
        const expAtOne = p0 * Math.exp(p1);
        if (Math.abs(p0 - domainMin) <= 1e-4 && Math.abs(expAtOne - domainMax) / Math.max(1, Math.abs(domainMax)) <= 0.02) {
          physical = p0 * Math.exp(p1 * t);
        } else {
          const denom = Math.exp(p1) - 1.0;
          const shaped = Math.abs(denom) > 1e-9 ? (Math.exp(p1 * t) - 1.0) / denom : t;
          physical = domainMin + shaped * (domainMax - domainMin);
        }
        break;
      }
      case 'Pow': {
        const shaped = Math.pow(t, p1);
        physical = domainMin + shaped * (domainMax - domainMin);
        break;
      }
      case 'SymBipolar': {
        // Centro exacto en t = 0.5 -> 0.0 físico cuando domainMin < 0 < domainMax
        if (domainMin < 0 && domainMax > 0) {
          if (Math.abs(t - 0.5) < 1e-7) return 0.0;
          physical = t < 0.5 ? domainMin * ((0.5 - t) / 0.5) : domainMax * ((t - 0.5) / 0.5);
        } else {
          physical = domainMin + t * (domainMax - domainMin);
        }
        break;
      }
      case 'Linear':
      case 'PiecewiseLinear':
      case 'Lut':
      case 'None':
      default:
        physical = domainMin + t * (domainMax - domainMin);
        break;
    }

    const lo = Math.min(domainMin, domainMax);
    const hi = Math.max(domainMin, domainMax);
    return Math.max(lo, Math.min(hi, physical));
  }

  /** Evalúa la conversión inversa Dominio Físico -> Normalizado [0,1] */
  public static evalDomainToNormalized(meta: ParameterMeta, domainRaw: number): number {
    const { curve, domainMin, domainMax } = meta;
    if (!Number.isFinite(domainRaw) || domainMax === domainMin) return 0.0;

    const lo = Math.min(domainMin, domainMax);
    const hi = Math.max(domainMin, domainMax);
    const domain = Math.max(lo, Math.min(hi, domainRaw));

    const p0 = meta.curveP0 && meta.curveP0 > 0 ? meta.curveP0 : domainMin > 0 ? domainMin : 1.0;
    const p1 =
      meta.curveP1 && meta.curveP1 !== 0
        ? meta.curveP1
        : domainMin > 0 && domainMax > domainMin
          ? Math.log(domainMax / domainMin)
          : 1.0;

    let t: number;
    switch (curve) {
      case 'Exp': {
        const expAtOne = p0 * Math.exp(p1);
        if (Math.abs(p0 - domainMin) <= 1e-4 && Math.abs(expAtOne - domainMax) / Math.max(1, Math.abs(domainMax)) <= 0.02) {
          if (domain <= p0) return 0.0;
          t = Math.log(domain / p0) / p1;
        } else {
          const rel = (domain - domainMin) / (domainMax - domainMin);
          const denom = Math.exp(p1) - 1.0;
          t = Math.abs(denom) > 1e-9 ? Math.log(1.0 + rel * denom) / p1 : rel;
        }
        break;
      }
      case 'Pow': {
        const rel = Math.max(0.0, Math.min(1.0, (domain - domainMin) / (domainMax - domainMin)));
        t = Math.pow(rel, 1.0 / p1);
        break;
      }
      case 'SymBipolar': {
        if (domainMin < 0 && domainMax > 0) {
          if (Math.abs(domain) < 1e-7) return 0.5;
          t = domain < 0 ? 0.5 * (1.0 - domain / domainMin) : 0.5 + 0.5 * (domain / domainMax);
        } else {
          t = (domain - domainMin) / (domainMax - domainMin);
        }
        break;
      }
      case 'Linear':
      case 'PiecewiseLinear':
      case 'Lut':
      case 'None':
      default:
        t = (domain - domainMin) / (domainMax - domainMin);
        break;
    }

    return Math.max(0.0, Math.min(1.0, t));
  }

  /** Convierte un valor Wire crudo (ej. CC 0..127 o bipolar -64..+63) a Dominio Físico */
  public static evalWireToDomain(meta: ParameterMeta, rawWire: number): number {
    const wMin = meta.min ?? 0;
    const wMax = meta.max ?? 127;
    const zeroCenter =
      meta.wireZeroCenter !== undefined
        ? meta.wireZeroCenter
        : meta.domainMin === -meta.domainMax && wMin === 0 && wMax === 127
          ? 64
          : meta.domainMin === -meta.domainMax && wMin < 0 && wMax > 0
            ? 0
            : undefined;

    if (zeroCenter !== undefined && meta.domainMin < 0 && meta.domainMax > 0) {
      if (rawWire === zeroCenter) return 0.0;
      if (rawWire > zeroCenter) {
        return Math.min(meta.domainMax, meta.domainMax * ((rawWire - zeroCenter) / Math.max(1, wMax - zeroCenter)));
      }
      const effectiveMin = wMin === 0 && zeroCenter === 64 ? 1 : wMin;
      return Math.max(
        meta.domainMin,
        meta.domainMin * ((zeroCenter - Math.max(effectiveMin, rawWire)) / Math.max(1, zeroCenter - effectiveMin))
      );
    }

    const t = wMax > wMin ? (rawWire - wMin) / (wMax - wMin) : 0.0;
    return this.evalNormalizedToDomain(meta, t);
  }

  /** Convierte un valor de Dominio Físico a valor Wire entero (ej. CC 0..127) */
  public static evalDomainToWire(meta: ParameterMeta, domainValue: number): number {
    const wMin = meta.min ?? 0;
    const wMax = meta.max ?? 127;
    const zeroCenter =
      meta.wireZeroCenter !== undefined
        ? meta.wireZeroCenter
        : meta.domainMin === -meta.domainMax && wMin === 0 && wMax === 127
          ? 64
          : meta.domainMin === -meta.domainMax && wMin < 0 && wMax > 0
            ? 0
            : undefined;

    if (zeroCenter !== undefined && meta.domainMin < 0 && meta.domainMax > 0) {
      if (Math.abs(domainValue) < 1e-7) return zeroCenter;
      if (domainValue > 0) {
        const ratio = Math.min(1.0, domainValue / meta.domainMax);
        return Math.round(zeroCenter + ratio * (wMax - zeroCenter));
      }
      const effectiveMin = wMin === 0 && zeroCenter === 64 ? 1 : wMin;
      const ratio = Math.min(1.0, domainValue / meta.domainMin);
      return Math.round(zeroCenter - ratio * (zeroCenter - effectiveMin));
    }

    const t = this.evalDomainToNormalized(meta, domainValue);
    return Math.round(wMin + t * (wMax - wMin));
  }

  public static normalizedToDomain(id: string, t: number): number {
    const meta = this.paramCache.get(id) ?? this.roleCache.get(id);
    if (!meta) return t;
    return this.evalNormalizedToDomain(meta, t);
  }

  public static domainToNormalized(id: string, domain: number): number {
    const meta = this.paramCache.get(id) ?? this.roleCache.get(id);
    if (!meta) return domain;
    return this.evalDomainToNormalized(meta, domain);
  }

  public static midiToNormalized(
    wireCodec: 'Value' | 'Bipolar' | 'Enum',
    ccValue: number,
    zeroCenter = 64
  ): number {
    if (wireCodec === 'Bipolar') {
      if (ccValue < 0) {
        // Signed [-64..+63] or [-128..+127]
        return Math.max(0.0, Math.min(1.0, 0.5 + ccValue / 128.0));
      }
      // Unsigned 0..127 with hardware center at 64
      if (ccValue === zeroCenter) return 0.5;
      return Math.max(0.0, Math.min(1.0, 0.5 + (ccValue - zeroCenter) / 126.0));
    }
    return Math.max(0.0, Math.min(1.0, ccValue / 127.0));
  }

  public static normalizedToMidi(
    wireCodec: 'Value' | 'Bipolar' | 'Enum',
    normalized: number,
    zeroCenter = 64
  ): number {
    const t = Math.max(0.0, Math.min(1.0, normalized));
    if (wireCodec === 'Bipolar') {
      const raw = Math.round(zeroCenter + (t * 2.0 - 1.0) * 63.0);
      return Math.max(1, Math.min(127, raw));
    }
    return Math.max(0, Math.min(127, Math.round(t * 127.0)));
  }

  public static getParameterMeta(idOrRole: string): ParameterMeta | undefined {
    return this.paramCache.get(idOrRole) ?? this.roleCache.get(idOrRole);
  }

  public static getParameterIds(): string[] {
    return Array.from(this.paramCache.keys());
  }

  public normalizedToDomain(idOrRole: string, t: number): number {
    const meta = this.instanceCache.get(idOrRole) ?? this.instanceRoleCache.get(idOrRole) ?? MidiTranslationEngine.getParameterMeta(idOrRole);
    if (!meta) return t;
    return MidiTranslationEngine.evalNormalizedToDomain(meta, t);
  }

  public domainToNormalized(idOrRole: string, domain: number): number {
    const meta = this.instanceCache.get(idOrRole) ?? this.instanceRoleCache.get(idOrRole) ?? MidiTranslationEngine.getParameterMeta(idOrRole);
    if (!meta) return domain;
    return MidiTranslationEngine.evalDomainToNormalized(meta, domain);
  }

  public wireToDomain(idOrRole: string, rawWire: number): number {
    const meta = this.instanceCache.get(idOrRole) ?? this.instanceRoleCache.get(idOrRole) ?? MidiTranslationEngine.getParameterMeta(idOrRole);
    if (!meta) return rawWire;
    return MidiTranslationEngine.evalWireToDomain(meta, rawWire);
  }

  public domainToWire(idOrRole: string, domain: number): number {
    const meta = this.instanceCache.get(idOrRole) ?? this.instanceRoleCache.get(idOrRole) ?? MidiTranslationEngine.getParameterMeta(idOrRole);
    if (!meta) return Math.round(domain);
    return MidiTranslationEngine.evalDomainToWire(meta, domain);
  }

  public getMeta(idOrRole: string): ParameterMeta | undefined {
    return this.instanceCache.get(idOrRole) ?? this.instanceRoleCache.get(idOrRole) ?? MidiTranslationEngine.getParameterMeta(idOrRole);
  }
}

export const midiTranslationEngine = new MidiTranslationEngine();
