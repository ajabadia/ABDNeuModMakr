# CopilotShell - Componente Visual Compartido de Asistencia e IA

El componente `CopilotShell` (`@abdsynths/shared/components/copilot`) proporciona a las aplicaciones de la suite (`ABDNeuModMakr`, `ABDAxionikVS`, `ABDAudioLab`) una interfaz estandarizada y reactiva para asistencia guiada, documentacion tecnica y ejecucion de herramientas deterministas o por IA.

## Capacidades

1. **Panel Lateral Camaleon (Docked / Overlay)**:
   - Acoplado (`docked`) a la cuadricula de trabajo en pantallas anchas (`>= 1550px`).
   - Superpuesto (`overlay`, `z-index: 12000`) automaticamente si el ancho es menor o cuando se abre cualquier ventana modal en la aplicacion anfitriona.
2. **Carril Colapsable hacia la Derecha**:
   - Boton de colapso rapido con chevron derecho (`>`) que encoge el panel a un carril vertical de 42 px.
   - Boton de expansion con chevron izquierdo (`<`) para restaurar la vista completa (360 px).
3. **Pestanas de Trabajo**:
   - `Asistente`: Chat contextual, estado del sistema, fichas rapidas y acciones sugeridas con confirmacion.
   - `Manual`: Consulta de la base de conocimiento integrada (busqueda BM25) con enlaces interactivos a controles.
   - `Registro`: Historial de operaciones, logs y boton de deshacer ultima accion (`Undo`).
4. **Soporte Completo de Internacionalizacion (i18n)**:
   - Todos los botones, pestanas, etiquetas HUD, placeholders, mensajes del sistema y textos de estado del panel utilizan las claves canonicas `copilot.*` de `@abdsynths/shared/Components/I18n`.
   - Se actualiza reactivamente mediante el metodo `.applyI18n()` al conmutar el idioma en la aplicacion anfitriona (`setLocale()`), actualizando tanto la interfaz del shell como los articulos del manual suministrados (`kbArticles`).
   - El diccionario compartido incluye paridad 1:1 en espanol (`SHARED_ES.copilot`) e ingles (`SHARED_EN.copilot`) para todas las cadenas de la asistencia.
5. **Sistema Spotlight y Navegacion Guiada**:
   - Cualquier elemento del DOM etiquetado con `data-ai-target="target-id"` puede ser resaltado visualmente con un anillo animado de foco mediante `highlightUiTarget(targetId)`.
   - Soporte para enlaces en markdown: `[[target:target-id|Etiqueta del Control]]` o propiedad `uiTargets` en articulos del manual.
   - Soporte para navegacion activa mediante `onNavigateTarget(targetId)`.

---

## Contrato de Integracion

```typescript
import { CopilotShell } from '@abdsynths/shared/components/copilot';

const copilot = new CopilotShell({
  // Contenedores del DOM
  container: document.getElementById('copilot-mount'),
  hostShellEl: document.getElementById('app-shell'),
  modalsRootEl: document.getElementById('modals-container'),
  dockMinViewportWidth: 1550,

  // Motor i18n reactivo opcional (por defecto detecta window.__audiolab_i18n)
  i18n: myI18nInstance,

  // Orquestador y contexto (Opcional, puede operar 100% determinista sin IA)
  orchestrator: myCopilotOrchestrator,
  getHostContext: () => ({
    stateSnapshot: { /* ... */ },
    acousticSnapshot: { /* ... */ },
    suggestedPrompts: ['¿Como realizo una calibracion?', 'Ver tolerancias']
  }),

  // Navegacion guiada al pulsar chips de control Spotlight (Opcional)
  onNavigateTarget: (targetId: string) => {
    // Permite a la app anfitriona abrir modales, pestanas o submenus especificos:
    if (targetId === 'calib-wizard') openCalibrationWizard();
    else if (targetId === 'contract-inspector') openContractInspector();
  },

  // Manejadores de transacciones
  onUndoLastAction: async () => undoStack.undoLast(),
  onExecuteAction: async (action) => orchestrator.executeApprovedAction(action),

  // Articulos de la base de conocimiento de la app (KbArticle[])
  kbArticles: myKnowledgeBase
});

// Reactividad de idioma:
// Al cambiar el idioma en la aplicacion, invocar:
copilot.applyI18n();

// Si la aplicacion dispone de base de conocimiento bilingue (ES / EN):
copilot.kbArticles = getAppKnowledgeBase(currentLocale);
copilot.searchManual(''); // Refresca la vista del manual en el idioma activo
```

---

## Guia de Autoria del Manual Integrado (`KbArticle[]`) y Arquitectura de Recuperacion

El manual de cada aplicacion cumple una **doble funcion**:
1. Servir como **documentacion interactiva inmediata** para el usuario humano en la pestana `Manual` y en el modo `100% Determinista (Sin IA)`.
2. Actuar como **fuente de verdad inyectada dinamicamente al LLM** (Ollama local o Cloud BYOK). En cada turno de conversacion, `CopilotOrchestrator` ejecuta `searchKnowledgeBase(kb, query, { limit: 3 })` e inyecta solo los 3 articulos mas relevantes en el System Prompt (~1.2 KB), evitando saturar la ventana de contexto y sin necesidad de bases de datos vectoriales pesadas (RAG con embeddings).

### Por que BM25 Lexico + Stemming Ligero en lugar de RAG Vectorial
- **Peso Cero y Latencia < 1 ms**: Un manual completo de aplicacion (30 a 80 articulos bien estructurados) ocupa entre 25 KB y 50 KB en memoria. El motor `kbSearch.ts` normaliza acentos, filtra palabras vacias (*stopwords* como `como`, `para`, `el`, `mi`) y aplica *light stemming* en espanol e ingles, logrando precision inmediata sin descargar modelos de embeddings de decenas de megabytes.
- **Exactitud Tecnica**: En aplicaciones de audio y sintesis, el usuario busca terminos exactos (`SF2`, `96 kHz`, `Ctrl+B`, `scape`, `THD`, `cruce por cero`, `huecos MIDI`) donde la busqueda lexica BM25 supera a los embeddings semanticos difusos.

### Estructura Canonica de un Articulo (`KbArticle`)

```typescript
export interface KbArticle {
  id: string;                 // Identificador unico estable (ej. 'kb-loop-editor')
  stage?: string | number;    // Opcional: etapa o modo de la app a la que aplica
  tags: string[];             // Sinonimos coloquiales, verbos de intencion, formatos y atajos
  triggerCodes?: string[];    // Opcional: codigos de error o alertas que disparan este articulo
  title: string;              // Titulo natural orientado a la accion o pregunta del usuario
  whatItMeans: string;        // Explicacion clara de que hace la funcion y para que sirve (2-3 frases)
  howToFixSteps: string[];    // Pasos accionables en orden logico (incluyendo rutas de menu y atajos)
  uiTargets?: Array<{         // Botones interactivos Spotlight que abren o iluminan la funcion
    targetId: string;
    label: string;
  }>;
}
```

### Reglas de Oro para Escribir Articulos Efectivos

1. **Pensa en como pregunta un usuario real (Vocabulario de Intencion en `tags`)**:
   - Un usuario rara vez busca el nombre interno de una clase (`AudioChopperModal` o `autoRepairCoverage`). Busca por su problema o intencion: *"cortar audio largo"*, *"trocear bateria"*, *"quitar chasquido en bucle"*, *"rellenar notas vacias"*, *"guardar mi trabajo"*, *"no suena nada"*.
   - Incluye siempre en `tags`:
     - **Verbos de accion**: `crear`, `importar`, `abrir`, `guardar`, `cortar`, `grabar`, `exportar`, `arreglar`.
     - **Terminos coloquiales y tecnicos**: `bucle` y `loop`, `chasquido` y `clic`, `huecos` y `gaps`, `muestras` y `samples`, `carpeta` y `lotes`.
     - **Extensiones y atajos**: `wav`, `sf2`, `sfz`, `zip`, `ctrl+i`, `ctrl+p`, `f1`.

2. **Cobertura Completa de la Interfaz**:
   - El manual no debe limitarse a la teoria DSP del sintetizador; debe cubrir **todos los menus y flujos de la aplicacion anfitriona**:
     - Menu `Archivo` (sesiones `.json`, importaciones individuales/carpetas/samplers, exportaciones, base de datos local).
     - Menu `Editar` (deshacer/rehacer, insertar/eliminar zonas, reparacion de cobertura, preferencias).
     - Menu `Modelo / Herramientas` (grabadora, editor de bucles, troceador, asistente guiado, portadas, lotes, modos de trabajo).
     - Menu `Vista` (visor espectral, navegador de bancos, temas/skins, modo claro/oscuro, idioma).
     - Menu `Ayuda` (diagnostico de salud, Companion Bridge Python, instalacion PWA).
     - Solucion de problemas frecuentes (*Troubleshooting*).

3. **Redaccion Orientada tanto a Humanos como al LLM**:
   - En `whatItMeans`: explica **que es** y **cuando conviene usarlo**, incluyendo limites exactos (por ejemplo, *"64 parciales a 44.1 kHz en modo Clasico"*). Esos datos factuales impiden que el LLM invente cifras.
   - En `howToFixSteps`: redacta instrucciones directas indicando **Ruta de Menu + Atajo de Teclado + Accion** (ej. *"Abre Modelo > Herramientas > Editor de Bucles o pulsa el icono de onda en la zona"*).

4. **Vinculacion Obligatoria con `uiTargets` y `onNavigateTarget`**:
   - Todo articulo que describa una herramienta, panel o modal de la aplicacion debe incluir al menos un `uiTargets: [{ targetId: '...', label: '...' }]`.
   - Verifica que cada `targetId` exista en la lista blanca `CANONICAL_UI_TARGETS` y este conectado en el callback `onNavigateTarget` de la aplicacion para que el boton del manual abra o enfoque la herramienta al hacer clic.

---

## Directrices de Diseno y Estilo

* **Tokens de Tema**: El componente no utiliza colores fijos ni fondos arbitrarios. Toda su apariencia se adapta mediante las variables canonicas de `@abdsynths/shared/styles/tokens.css` (`--color-panel-bg`, `--color-panel-surface`, `--color-panel-border`, `--color-accent`, `--color-text-main`, etc.).
* **Regla Tipografica**: Prohibido el uso de emojis y guiones largos en literales de interfaz de usuario.
