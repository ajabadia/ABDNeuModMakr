/**
 * ABDKeyboard — Parameter Lookup Functions
 * ==============================================
 * Schema-driven lookup between MIDI raw values (CC 0-127) and physical domains.
 * Uses parameter dictionaries (JSON schemas) as single source of truth.
 *
 * Single source of truth: schemas in ABDSharedAssets/contracts/
 */

import korg_ms2000_parameter_spec from '@abdsynths/shared/contracts/korg_ms2000_parameter_spec.json';
import abdms2000_modulation_matrix from '@abdsynths/shared/contracts/abdms2000_modulation_matrix.json';
import behringer_deepmind12 from '@abdsynths/shared/contracts/behringer_deepmind12.json';
import behringer_deepmind12_parameter_spec from '@abdsynths/shared/contracts/behringer_deepmind12_parameter_spec.json';
import behringer_deepmind6 from '@abdsynths/shared/contracts/behringer_deepmind6.json';
import behringer_deepmind6_parameter_spec from '@abdsynths/shared/contracts/behringer_deepmind6_parameter_spec.json';
import casio_cz101 from '@abdsynths/shared/contracts/casio_cz101.json';
import casio_cz101_parameter_spec from '@abdsynths/shared/contracts/casio_cz101_parameter_spec.json';
import casio_cz1000 from '@abdsynths/shared/contracts/casio_cz1000.json';
import casio_cz5000 from '@abdsynths/shared/contracts/casio_cz5000.json';
import behringer_jt4000 from '@abdsynths/shared/contracts/behringer_jt4000.json';
import behringer_provs_mini from '@abdsynths/shared/contracts/behringer_provs_mini.json';
import generic_midi_synth from '@abdsynths/shared/contracts/generic_midi_synth.json';
import s950_calibration from '@abdsynths/shared/contracts/s950_calibration.json';
import s950_patch_fields from '@abdsynths/shared/contracts/s950_patch_fields.json';
import neuronik_modulation_matrix from '@abdsynths/shared/contracts/neuronik_modulation_matrix.json';
import roland_aira_bitrazer from '@abdsynths/shared/contracts/roland_aira_bitrazer.json';
import roland_aira_demora from '@abdsynths/shared/contracts/roland_aira_demora.json';
import roland_aira_patch_spec from '@abdsynths/shared/contracts/roland_aira_patch_spec.json';
import roland_aira_submodules from '@abdsynths/shared/contracts/roland_aira_submodules.json';
import roland_aira_torcido from '@abdsynths/shared/contracts/roland_aira_torcido.json';
import roland_hs60 from '@abdsynths/shared/contracts/roland_hs60.json';
import roland_juno106 from '@abdsynths/shared/contracts/roland_juno106.json';
import roland_juno106_parameter_spec from '@abdsynths/shared/contracts/roland_juno106_parameter_spec.json';
import roland_juno6 from '@abdsynths/shared/contracts/roland_juno6.json';
import roland_juno60 from '@abdsynths/shared/contracts/roland_juno60.json';
import yamaha_dx7ii from '@abdsynths/shared/contracts/yamaha_dx7ii.json';

// Cache de parámetros cargados
const paramCache = new Map();

/**
 * Carga los parámetros de un schema específico al cache
 */
function loadSchemaParameters(schema) {
  if (!schema) return;

  // Formato parameter_spec (array parameters)
  if (Array.isArray(schema.parameters)) {
    schema.parameters.forEach((p) => {
      const id = p.id;
      if (id && !paramCache.has(id)) {
        paramCache.set(id, {
          id: p.id,
          name: p.name,
          wire: p.wire,
          wireCodec: p.wireCodec,
          curve: p.curve || 'Linear',
          curveP0: typeof p.curveP0 === 'number' ? p.curveP0 : 1.0,
          curveP1: typeof p.curveP1 === 'number' ? p.curveP1 : 1.0,
          domainMin: typeof p.domainMin === 'number' ? p.domainMin : (typeof p.min === 'number' ? p.min : 0),
          domainMax: typeof p.domainMax === 'number' ? p.domainMax : (typeof p.max === 'number' ? p.max : 127),
          unit: p.unit || '',
          smoothing: p.smoothing || 'Linear',
        });
      }
    });
  }

  // Formato hardware_profile (functions con controls)
  if (Array.isArray(schema.functions)) {
    schema.functions.forEach((f) => {
      if (Array.isArray(f.controls)) {
        f.controls.forEach((c) => {
          const id = c.id || c.name?.toLowerCase().replace(/[\s\/-]+/g, '_') || '';
          if (id && !paramCache.has(id)) {
            paramCache.set(id, {
              id: id,
              name: c.name,
              wire: 'CC',
              wireCodec: 'Value',
              curve: 'Linear',
              curveP0: 1.0,
              curveP1: 1.0,
              domainMin: typeof c.minVal === 'number' ? c.minVal : 0,
              domainMax: typeof c.maxVal === 'number' ? c.maxVal : 127,
              unit: c.unit || '',
              smoothing: 'Linear',
            });
          }
        });
      }
    });
  }
}

/**
 * Carga todos los parámetros de los schemas al iniciar
 */
export function init() {
  paramCache.clear();

  loadSchemaParameters(korg_ms2000_parameter_spec);
  loadSchemaParameters(abdms2000_modulation_matrix);
  loadSchemaParameters(behringer_deepmind12_parameter_spec);
  loadSchemaParameters(behringer_deepmind6_parameter_spec);
  loadSchemaParameters(behringer_deepmind12);
  loadSchemaParameters(behringer_deepmind6);
  loadSchemaParameters(casio_cz101_parameter_spec);
  loadSchemaParameters(casio_cz101);
  loadSchemaParameters(casio_cz1000);
  loadSchemaParameters(casio_cz5000);
  loadSchemaParameters(behringer_jt4000);
  loadSchemaParameters(behringer_provs_mini);
  loadSchemaParameters(generic_midi_synth);
  loadSchemaParameters(s950_calibration);
  loadSchemaParameters(s950_patch_fields);
  loadSchemaParameters(neuronik_modulation_matrix);
  loadSchemaParameters(roland_aira_bitrazer);
  loadSchemaParameters(roland_aira_demora);
  loadSchemaParameters(roland_aira_patch_spec);
  loadSchemaParameters(roland_aira_submodules);
  loadSchemaParameters(roland_aira_torcido);
  loadSchemaParameters(roland_hs60);
  loadSchemaParameters(roland_juno106_parameter_spec);
  loadSchemaParameters(roland_juno106);
  loadSchemaParameters(roland_juno6);
  loadSchemaParameters(roland_juno60);
  loadSchemaParameters(yamaha_dx7ii);

  // Parámetro canónico de osc1Gain para compatibilidad
  if (!paramCache.has('osc1Gain')) {
    paramCache.set('osc1Gain', {
      id: 'osc1Gain',
      curve: 'Linear',
      curveP0: 1.0,
      curveP1: 1.0,
      domainMin: 0.0,
      domainMax: 1.0,
      unit: '',
      smoothing: 'Linear',
    });
  }

  // Alias resonance -> filterResonance
  if (!paramCache.has('resonance') && paramCache.has('filterResonance')) {
    paramCache.set('resonance', {
      ...paramCache.get('filterResonance'),
      id: 'resonance',
    });
  }
}

/**
 * Convierte un valor raw de MIDI (CC 0-127) al dominio físico
 *
 * @param {string} id - Identificador único del parámetro
 * @param {number} raw - Valor raw de MIDI (0-127)
 * @returns {number} Valor en dominio físico (Hz, segundos, etc.)
 */
export function lookupRawValue(id, raw) {
  const meta = paramCache.get(id);
  if (!meta) {
    return raw; // Fallback: retornar raw sin convertir
  }

  const { curve, curveP0, curveP1, domainMin, domainMax } = meta;
  const t = Math.max(0.0, Math.min(1.0, raw / 127.0));

  switch (curve) {
    case 'Linear':
      return t * (domainMax - domainMin) + domainMin;

    case 'Exp':
      // Fórmula canónica: P0 * e^(P1 * t)
      if (typeof curveP0 === 'number' && typeof curveP1 === 'number') {
        return curveP0 * Math.exp(curveP1 * t);
      }
      return t * (domainMax - domainMin) + domainMin;

    case 'Pow': {
      // t ^ curveP1 escalado al dominio físico
      const p = typeof curveP1 === 'number' ? curveP1 : 1.0;
      return Math.pow(t, p) * (domainMax - domainMin) + domainMin;
    }

    case 'None':
    default:
      return t * (domainMax - domainMin) + domainMin;
  }
}

/**
 * Convierte un valor del dominio físico a raw de MIDI (CC 0-127)
 *
 * @param {string} id - Identificador único del parámetro
 * @param {number} domainValue - Valor en dominio físico
 * @returns {number} Valor raw de MIDI (0-127)
 */
export function domainToRawValue(id, domainValue) {
  const meta = paramCache.get(id);
  if (!meta) {
    return 64; // Fallback: valor medio
  }

  const { curve, curveP0, curveP1, domainMin, domainMax } = meta;

  switch (curve) {
    case 'Exp': {
      if (!curveP0 || !curveP1 || domainValue <= 0) return 0;
      const t = Math.log(domainValue / curveP0) / curveP1;
      return Math.max(0, Math.min(127, Math.round(t * 127.0)));
    }

    case 'Pow': {
      const span = domainMax - domainMin;
      if (span <= 0) return 0;
      const normalized = Math.max(0.0, Math.min(1.0, (domainValue - domainMin) / span));
      const p = typeof curveP1 === 'number' && curveP1 !== 0 ? curveP1 : 1.0;
      const t = Math.pow(normalized, 1.0 / p);
      return Math.max(0, Math.min(127, Math.round(t * 127.0)));
    }

    case 'Linear':
    case 'None':
    default: {
      const span = domainMax - domainMin;
      if (span <= 0) return 0;
      const normalized = Math.max(0.0, Math.min(1.0, (domainValue - domainMin) / span));
      return Math.max(0, Math.min(127, Math.round(normalized * 127.0)));
    }
  }
}

/**
 * Lookup con interpolación y soporte de clamp estricto
 *
 * @param {string} id - Identificador del parámetro
 * @param {number} raw - Valor raw (posiblemente fuera de [0, 127])
 * @returns {number} Valor en dominio físico
 */
export function lookupRawValueWithInterpolation(id, raw) {
  const meta = paramCache.get(id);
  if (!meta) {
    return raw;
  }

  const { domainMin, domainMax } = meta;

  // Clamp estricto del valor raw antes de lookup
  if (raw <= 0) return domainMin;
  if (raw >= 127) return domainMax;

  return lookupRawValue(id, raw);
}

// ── Conversiones de Aftertouch y ModWheel ────────────────────────────────────

/**
 * Convierte CC de Aftertouch (0-127) a presión normalizada [0.0, 1.0]
 */
export function rawToAftertouchPressure(raw) {
  const clamped = Math.max(0, Math.min(127, Number(raw) || 0));
  return clamped / 127.0;
}

/**
 * Convierte CC de ModWheel (0-127) a profundidad normalizada [0.0, 1.0]
 */
export function rawToModWheelDepth(raw) {
  const clamped = Math.max(0, Math.min(127, Number(raw) || 0));
  return clamped / 127.0;
}

/**
 * Convierte presión normalizada [0.0, 1.0] a CC de Aftertouch [0, 127]
 */
export function pressureToRaw(pressure) {
  const clamped = Math.max(0.0, Math.min(1.0, Number(pressure) || 0));
  return Math.round(clamped * 127.0);
}

/**
 * Convierte profundidad normalizada [0.0, 1.0] a CC de ModWheel [0, 127]
 */
export function modWheelToRaw(depth) {
  const clamped = Math.max(0.0, Math.min(1.0, Number(depth) || 0));
  return Math.round(clamped * 127.0);
}

/**
 * Retorna valor en dominio físico para Aftertouch
 */
export function rawToAftertouchDomain(raw) {
  return rawToAftertouchPressure(raw);
}

/**
 * Retorna valor en dominio físico para ModWheel
 */
export function rawToModWheelDomain(raw) {
  return rawToModWheelDepth(raw);
}

// Inicialización automática del módulo
init();