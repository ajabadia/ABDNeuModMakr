/**
 * ABD avisos de LCD — contrato compartido de TEXTOS de la pantalla.
 *
 * El mismo aviso nace en sitios distintos (menu, panel LCD, drawer, bridge
 * nativo); aqui se compone UNA vez y todos los consumidores pintan el resultado.
 * Ningun modulo parafrasea el aviso de otro ni mantiene su copia.
 *
 * Reglas (Docs/ui-ux/LCD_GUIDE.md §5):
 * - Builder puro: devuelve { line1, line2 }, sin DOM, sin estado, sin estilos.
 * - La entrada son datos del dominio; normaliza y clampea para que nunca llegue
 *   undefined a la pantalla.
 * - Solo sube aqui el texto que comparten dos o mas synths. El catalogo propio
 *   de un motor (perfiles de hardware, etiquetas de modo) se queda en el synth.
 *
 * Uso:
 *   import { buildWriteCompletedNotice } from '@abdsynths/shared/components';
 *   const { line1, line2 } = buildWriteCompletedNotice({ programId: p.id, programName: p.name });
 */

/**
 * Resultado de guardar un programa. El panel LCD conoce el programa recien
 * escrito; el guardado desde un menu no, y aun asi ambos deben decir lo mismo.
 * @param {{ programId?: string, programName?: string }} [options]
 * @returns {{ line1: string, line2: string }}
 */
export function buildWriteCompletedNotice({ programId, programName } = {}) {
  const id = String(programId || '').trim();
  const name = String(programName || '').trim();
  return {
    line1: 'WRITE COMPLETED',
    line2: id ? `SAVED TO ${id}${name ? ` (${name})` : ''}` : 'PATCH SAVED',
  };
}
