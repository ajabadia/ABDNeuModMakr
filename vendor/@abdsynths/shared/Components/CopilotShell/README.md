# CopilotShell — Componente Visual Compartido de Asistencia e IA

El componente `CopilotShell` (`@abdsynths/shared/components/copilot`) proporciona a las aplicaciones de la suite (`ABDNeuModMakr`, `ABDAxionikVS`, `ABDAudioLab`) una interfaz estandarizada y reactiva para asistencia guiada, documentación técnica y ejecución de herramientas deterministas o por IA.

## Capacidades

1. **Panel Lateral Camaleón (Docked / Overlay)**:
   - Acoplado (`docked`) a la cuadrícula de trabajo en pantallas anchas (`>= 1550px`).
   - Superpuesto (`overlay`, `z-index: 12000`) automáticamente si el ancho es menor o cuando se abre cualquier ventana modal en la aplicación anfitriona.
2. **Carril Colapsable hacia la Derecha**:
   - Botón de colapso rápido con chevron derecho (`>`) que encoge el panel a un carril vertical de 42 px.
   - Botón de expansión con chevron izquierdo (`<`) para restaurar la vista completa (360 px).
3. **Pestañas de Trabajo**:
   - `Asistente`: Chat contextual, estado del sistema, fichas rápidas y acciones sugeridas con confirmación.
   - `Manual`: Consulta de la base de conocimiento integrada (búsqueda BM25) con enlaces interactivos a controles.
   - `Registro`: Historial de operaciones, logs y botón de deshacer última acción (`Undo`).
4. **Sistema Spotlight y Navegación Guiada**:
   - Cualquier elemento del DOM etiquetado con `data-ai-target="target-id"` puede ser resaltado visualmente con un anillo animado de foco mediante `highlightUiTarget(targetId)`.
   - Soporte para enlaces en markdown: `[[target:target-id|Etiqueta del Control]]` o propiedad `uiTargets` en artículos del manual.
   - Soporte para navegación activa mediante `onNavigateTarget(targetId)`.

---

## Contrato de Integración

```typescript
import { CopilotShell } from '@abdsynths/shared/components/copilot';

const copilot = new CopilotShell({
  // Contenedores del DOM
  container: document.getElementById('copilot-mount'),
  hostShellEl: document.getElementById('app-shell'),
  modalsRootEl: document.getElementById('modals-container'),
  dockMinViewportWidth: 1550,

  // Orquestador y contexto (Opcional, puede operar 100% determinista sin IA)
  orchestrator: myCopilotOrchestrator,
  getHostContext: () => ({
    stateSnapshot: { /* ... */ },
    acousticSnapshot: { /* ... */ },
    suggestedPrompts: ['¿Cómo realizo una calibración?', 'Ver tolerancias']
  }),

  // Navegación guiada al pulsar chips de control Spotlight (Opcional)
  onNavigateTarget: (targetId: string) => {
    // Permite a la app anfitriona abrir modales, pestañas o submenús específicos:
    if (targetId === 'calib-wizard') openCalibrationWizard();
    else if (targetId === 'contract-inspector') openContractInspector();
  },

  // Manejadores de transacciones
  onUndoLastAction: async () => undoStack.undoLast(),
  onExecuteAction: async (action) => orchestrator.executeApprovedAction(action),

  // Artículos de la base de conocimiento de la app (KbArticle[])
  kbArticles: myKnowledgeBase
});
```

---

## Directrices de Diseño y Estilo

* **Tokens de Tema**: El componente no utiliza colores fijos ni fondos arbitrarios. Toda su apariencia se adapta mediante las variables canónicas de `@abdsynths/shared/styles/tokens.css` (`--color-panel-bg`, `--color-panel-surface`, `--color-panel-border`, `--color-accent`, `--color-text-main`, etc.).
* **Regla Tipográfica**: Prohibido el uso de emojis y guiones largos (`—`) en literales de interfaz de usuario.
