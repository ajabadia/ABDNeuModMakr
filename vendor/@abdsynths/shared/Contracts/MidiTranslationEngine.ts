/**
 * ABDMS2000 — MidiTranslationEngine
 * Motor de traducciones schema-driven entre:
 *   • Valores normalizados [0,1] ↔ Dominio físico (Hz, s, dB, etc.)
 *   • Valores CC/MIDI (0-127) ↔ Valores normalizados [0,1]
 *   • Información de parámetro (wire type, curve, domainMin/Max, unit)
 *
 * Este engine consume el schema `korg_ms2000_parameter_spec.json` como fuente
 * de verdad para todas las conversiones, igual que el C++ `conversion::normalizedToDomain()`.
 *
 * Filosofía: Igual que el C++ usa `conversion::normalizedToDomain(entry, t)`,
 * este engine TypeScript usa `translationEngine.normalizedToDomain(id, t)`.
 * Single source of truth: el schema JSON.
 */

import { korg_ms2000_parameter_spec } from './korg_ms2000_parameter_spec';

/**
 * Tipo de curva de conversión (mismo enum que en C++ ParameterMeta)
 */
export type CurveType = 'Linear' | 'Exp' | 'Pow' | 'None';

/**
 * Interfaz de metadato de parámetro (parcheado desde el schema JSON)
 */
export interface ParameterMeta {
  id: string;
  wire: 'CC' | 'None' | 'SysEx' | 'Nrpn';
  wireCodec: 'Value' | 'Bipolar' | 'Enum';
  curve: CurveType;
  curveP0: number; // Parámetro P0 de la curva (ej. para Exp: escala inicial)
  curveP1: number; // Parámetro P1 de la curva (ej. para Exp: tasa de exponencialidad)
  domainMin: number; // Mínimo físico (ej. 20.0 para Hz)
  domainMax: number; // Máximo físico (ej. 20000.0 para Hz)
  unit: string | null; // Unidad física (ej. "Hz", "s", "dB", null=generic)
  smoothing: 'Linear' | 'Log';
}

/**
 * Motor de traductions schema-driven
 */
export class MidiTranslationEngine {

  /** Cache de metadatos de parámetros cargados desde el schema */
  private static paramCache: Map<string, ParameterMeta> = new Map();

  /** Cargar todos los parámetros del schema al iniciar */
  static async init(): Promise<void> {
    // El schema se carga estáticamente; los parámetros ya vienen definidos
    // en korg_ms2000_parameter_spec.json importado arriba.
    // Aquí podríamos hacer validación o enriquecimiento si fuera necesario.
    const params = korg_ms2000_parameter_spec.parameters;
    params.forEach(p => {
      this.paramCache.set(p.id, {
        id: p.id,
        wire: p.wire,
        wireCodec: p.wireCodec,
        curve: p.curve,
        curveP0: p.curveP0,
        curveP1: p.curveP1,
        domainMin: p.domainMin,
        domainMax: p.domainMax,
        unit: p.unit,
        smoothing: p.smoothing,
      });
    });
  }

  /**
   * Convierte un valor normalizado [0,1] al dominio físico segun la curva del parámetro.
   * Igual que `conversion::normalizedToDomain()` en C++.
   */
  static normalizedToDomain(id: string, t: number): number {
    const meta = this.paramCache.get(id);
    if (!meta) {
      // Fallback: si no encontramos el parámetro, retornamos t * domainMax como approximation
      console.warn(`MidiTranslationEngine: parámetro "${id}" no encontrado en cache`);
      return t * (meta?.domainMax ?? 1.0);
    }

    const { curve, curveP0, curveP1, domainMin, domainMax } = meta;

    // Aplicar curva segun el tipo
    let normalized = t;

    switch (curve) {
      case 'Linear':
        normalized = t; // Identidad
        break;

      case 'Exp':
        // curveP0 * e^(curveP1 * t)
        if (curveP0 <= 0) curveP0 = 1.0;
        normalized = curveP0 * Math.exp(curveP1 * t);
        break;

      case 'Pow':
        // t ^ curveP1 (clamp t a [0,1] para evitar NaN con potencias negativas)
        const tClamped = Math.max(0.0, Math.min(1.0, t));
        normalized = Math.pow(tClamped, curveP1);
        break;

      case 'None':
      default:
        normalized = t;
        break;
    }

    // Mapear al dominio físico: [domainMin, domainMax]
    // Usar interpolación lineal simple entre el rango [0,1] mapeado a [domainMin, domainMax]
    const physical = normalized * (domainMax - domainMin) + domainMin;

    return physical;
  }

  /**
   * Convierte el dominio físico a valor normalizado [0,1] (inverse de normalizedToDomain).
   */
  static domainToNormalized(id: string, domain: number): number {
    const meta = this.paramCache.get(id);
    if (!meta) {
      console.warn(`MidiTranslationEngine: parámetro "${id}" no encontrado en cache`);
      return domain / (meta?.domainMax ?? 1.0);
    }

    const { curve, curveP0, curveP1, domainMin, domainMax } = meta;

    // Paso 1: Desmapear del dominio físico al rango [0,1] relativo
    let relative = (domain - domainMin) / (domainMax - domainMin);
    relative = Math.max(0.0, Math.min(1.0, relative)); // Clamp a [0,1]

    // Paso 2: Aplicar curva inversa
    let normalized = relative;

    switch (curve) {
      case 'Linear':
        normalized = relative; // Identidad
        break;

      case 'Exp':
        // Inversa de curveP0 * e^(curveP1 * t): (1/curveP1) * ln(relative / curveP0)
        if (curveP0 <= 0) curveP0 = 1.0;
        if (curveP1 <= 0) curveP1 = 1.0;
        if (relative <= 0) return 0.0;
        normalized = (1.0 / curveP1) * Math.log(relative / curveP0);
        break;

      case 'Pow':
        // Inversa de t ^ curveP1: relative ^ (1/curveP1)
        if (curveP1 <= 0) curveP1 = 1.0;
        if (relative <= 0) return 0.0;
        normalized = Math.pow(relative, 1.0 / curveP1);
        break;

      case 'None':
      default:
        normalized = relative;
        break;
    }

    return normalized;
  }

  /**
   * Convierte un valor CC MIDI (0-127) a valor normalizado [0,1] segun wireCodec.
   * Igual que `wireToDomain` en C++ pero normalizando a [0,1].
   */
  static midiToNormalized(wireCodec: 'Value' | 'Bipolar', ccValue: number): number {
    let t = 0.0;

    switch (wireCodec) {
      case 'Value':
        // raw 0-127 -> t = raw/127.0
        t = ccValue / 127.0;
        break;

      case 'Bipolar':
        // raw -128 to 127 -> t = (raw+128)/255.0 (adaptado para [0,1])
        t = (ccValue + 128) / 255.0;
        break;

      case 'Enum':
      default:
        t = ccValue / 127.0;
        break;
    }

    // Clamp a [0,1]
    return Math.max(0.0, Math.min(1.0, t));
  }

  /**
   * Convierte un valor normalizado [0,1] a valor CC MIDI (0-127) segun wireCodec.
   */
  static normalizedToMidi(wireCodec: 'Value' | 'Bipolar', normalized: number): number {
    let ccValue = 0;

    switch (wireCodec) {
      case 'Value':
        // t = raw/127.0 -> raw = t * 127.0, clamp 0-127
        ccValue = Math.round(normalized * 127.0);
        break;

      case 'Bipolar':
        // t = (raw+128)/255.0 -> raw = (t * 255.0) - 128, clamp -128 to 127
        ccValue = Math.round((normalized * 255.0) - 128.0);
        break;

      case 'Enum':
      default:
        ccValue = Math.round(normalized * 127.0);
        break;
    }

    // Clamp a rangos válidos
    if (wireCodec === 'Bipolar') {
      return Math.max(-128, Math.min(127, ccValue));
    }
    return Math.max(0, Math.min(127, ccValue));
  }

  /**
   * Obtener metadato de un parámetro por ID.
   */
  static getParameterMeta(id: string): ParameterMeta | undefined {
    return this.paramCache.get(id);
  }

  /** Obtener todos los IDs de parámetros registrados */
  static getParameterIds(): string[] {
    return Array.from(this.paramCache.keys());
  }
}

/** Exportar instancia lista para usar (singleton pattern) */
export const midiTranslationEngine = new MidiTranslationEngine();

/**
 * Inicializar el engine (cargar schema, etc.)
 * Llamar una vez al iniciar la aplicación:
 *   await midiTranslationEngine.init();
 */
export async function initMidiTranslationEngine(): Promise<void> {
  await midiTranslationEngine.init();
}

// Ejemplo de uso documentado:
/*
 * // Inicializar al cargar la app
 * await initMidiTranslationEngine();
 *
 * // Convertir valor normalizado a Hz (ej. LFO1 Frequency)
 * const hz = midiTranslationEngine.normalizedToDomain('lfo1Freq', 0.5); // ~10.0 Hz
 *
 * // Convertir CC 74 (Filter Cutoff) a valor normalizado
 * const norm = midiTranslationEngine.midiToNormalized('Value', 64); // ~0.502
 *
 * // Convertir valor físico a CC
 * const cc = midiTranslationEngine.normalizedToMidi('Value', 0.75); // ~96
 *
 * // Convertir dominio físico a normalizado
 * const norm = midiTranslationEngine.domainToNormalized('filterCutoff', 1000.0); // ~0.5
 */