// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Hartmann Neuron Knowledge Base & System Prompt
// 16 canonical verified articles + strict structured LLM prompt
// ─────────────────────────────────────────────────────────

import type { KbArticle } from '../../../../vendor/@abdsynths/shared/Code/AiCore/kbSearch.ts';

export const CANONICAL_UI_TARGETS = [
  'nav-import-samples',
  'nav-musician-wizard',
  'nav-batch-processor',
  'nav-compile-btn',
  'nav-ai-status-pill',
  'nav-copilot-toggle',
  'nav-bank-btn',
  'process-working-mode',
  'process-model-name',
  'process-param-set',
  'process-complexity',
  'process-dsp-algo',
  'process-cover-box',
  'process-start-btn',
  'zone-inspector-root',
  'zone-inspector-split-btn',
  'zone-inspector-delete-btn',
  'zone-inspector-loop-btn',
  'zone-inspector-chop-btn',
  'zone-inspector-record-btn',
  'zone-inspector-mw-btn',
  'btn-auto-repair'
] as const;

export function getNeuronKnowledgeBase(locale: 'es' | 'en' = 'es'): KbArticle[] {
  const isEs = locale === 'es';

  return [
    {
      id: 'kb-workflow-start',
      title: isEs ? 'Flujo de Trabajo Principal en 3 Pasos' : 'Core 3-Step Production Workflow',
      tags: ['workflow', 'inicio', 'pasos', 'flujo', 'crear', 'tutorial', 'start', 'guide'],
      whatItMeans: isEs
        ? 'El flujo de trabajo principal de creación de modelos consta de 3 etapas fundamentales: importación, mapeo y compilación.'
        : 'The core model creation workflow consists of 3 main stages: import, mapping, and compilation.',
      howToFixSteps: [
        isEs ? 'Importar muestras de audio (WAV, AIFF, SF2, SFZ) mediante Importar Muestras o con el Asistente para Músicos.' : 'Import audio samples via Import Samples or Musician Wizard.',
        isEs ? 'Mapear y revisar las zonas MIDI 0..127, seleccionando el modo (Classic vs Extended), Parameter Set (0..9) y Complejidad (1..10).' : 'Map and review MIDI zones 0..127, picking working mode, Parameter Set and Complexity.',
        isEs ? 'Compilar el modelo con Compilar Modelo (Ctrl+P) y exportarlo a ZIP o AxionikDB.' : 'Compile model (Ctrl+P) and export to ZIP or AxionikDB.'
      ],
      uiTargets: [{ targetId: 'nav-import-samples', label: 'Importar Muestras' }],
    },
    {
      id: 'kb-scape-vs-sphere',
      title: isEs ? 'Concepto: Model (.scape/.sphere) frente a Sound (.sound)' : 'Concept: Model (.scape/.sphere) vs Sound (.sound)',
      tags: ['scape', 'sphere', 'sound', 'diferencia', 'modelo', 'resintesis', 'hartmann'],
      whatItMeans: isEs
        ? 'En la síntesis de Hartmann, el Modelo representa los datos espectrales analizados mientras que el Sonido representa la articulación y modulación.'
        : 'In Hartmann synthesis, Model represents analyzed spectral data while Sound represents articulation and modulation.',
      howToFixSteps: [
        isEs ? 'El archivo .scape modela la excitación/fuente temporal.' : 'The .scape file models temporal source excitation.',
        isEs ? 'El archivo .sphere modela el resonador espectral 3D.' : 'The .sphere file models 3D spectral resonator body.',
        isEs ? 'El archivo sound.script de 445 parámetros almacena envolventes, filtros y movimientos del Silver Stick.' : 'The 445-parameter sound.script stores envelopes, filters, and Silver Stick gestures.'
      ],
    },
    {
      id: 'kb-parameter-sets',
      title: isEs ? 'Tabla Exacta de los 10 Parameter Sets (0..9)' : 'Exact Table of 10 Parameter Sets (0..9)',
      tags: ['parameter set', 'conjunto', 'timbre', 'clasificacion', 'categoria', 'indices'],
      whatItMeans: isEs
        ? 'Hartmann Neuron clasifica los modelos exactamente en 10 Parameter Sets canónicos (0..9) para determinar las familias de parámetros de Scape y Sphere.'
        : 'Hartmann Neuron classifies models into 10 canonical Parameter Sets (0..9) determining parameter families for Scape and Sphere.',
      howToFixSteps: [
        '0: Synth & Neutral',
        '1: Strings / Winds & Brass',
        '2: Keyboards',
        '3: Plucked',
        '4: Bass',
        '5: Winds & Voice',
        '6: Pads & Textures',
        '7: Mallets & Bells',
        '8: Drums & Loop Factory',
        '9: SFX & Experimental'
      ],
      uiTargets: [{ targetId: 'process-param-set', label: 'Parameter Set' }],
    },
    {
      id: 'kb-complexity-recdepth',
      title: isEs ? 'Complejidad Espectral y Profundidad de Tramas (recDepth)' : 'Spectral Complexity & Frame Depth (recDepth)',
      tags: ['complexity', 'complejidad', 'recdepth', 'tramas', 'frames', 'resolucion'],
      whatItMeans: isEs
        ? 'La Complejidad (1..10) define la resolución de tramas temporales: [1, 4, 8, 12, 16, 24, 32, 42, 54, 64].'
        : 'Complexity (1..10) defines temporal frame depth: [1, 4, 8, 12, 16, 24, 32, 42, 54, 64].',
      howToFixSteps: [
        isEs ? 'Usar valores bajos (2..4) para percusiones secas o bajos estáticos para ahorrar memoria.' : 'Use low values (2..4) for drums or static basses to save memory.',
        isEs ? 'Usar valores altos (7..10) para colchones orquestales o notas evolutivas expresivas.' : 'Use high values (7..10) for evolving pads or expressive instruments.'
      ],
      uiTargets: [{ targetId: 'process-complexity', label: 'Complejidad' }],
    },
    {
      id: 'kb-modes-classic-extended',
      title: isEs ? 'Modo Classic frente a Modo Extended (Axionik Expanded)' : 'Classic Mode vs Extended Mode (Axionik Expanded)',
      tags: ['classic', 'extended', 'modo', 'v2', 'capsula', 'neuronvs'],
      whatItMeans: isEs
        ? 'Classic ofrece 100% de fidelidad al hardware de 2002; Extended aprovecha las capacidades modernas de ABDAxionikVS.'
        : 'Classic delivers 100% hardware 2002 fidelity; Extended unlocks modern ABDAxionikVS features.',
      howToFixSteps: [
        isEs ? 'Classic: 44.1 kHz, 64 parciales, teclado continuo 0..127 y MName de 11 caracteres ASCII.' : 'Classic: 44.1 kHz, 64 partials, contiguous 0..127 keys, and 11-char ASCII MName.',
        isEs ? 'Extended: matriz 2D Key x Velocity, Round-Robin, formantes Bark, DDSP y Surround Quad 4.0.' : 'Extended: 2D Key x Velocity matrix, Round-Robin, Bark formants, DDSP, and Quad 4.0 Surround.'
      ],
      uiTargets: [{ targetId: 'process-working-mode', label: 'Modo de Trabajo' }],
    },
    {
      id: 'kb-coverage-gaps',
      title: isEs ? 'Validación de Cobertura MIDI y Reparación de Huecos' : 'MIDI Coverage Validation & Gap Repair',
      tags: ['cobertura', 'gaps', 'huecos', 'solapes', 'teclado', 'auto-repair', 'midi'],
      whatItMeans: isEs
        ? 'En modo Clásico, el rango de notas MIDI 0..127 debe quedar cubierto sin huecos ni solapes involuntarios.'
        : 'In Classic mode, MIDI notes 0..127 must be fully covered without gaps or overlaps.',
      howToFixSteps: [
        isEs ? 'Pulsa el botón Auto-Reparar Cobertura para expandir los límites de las zonas automáticamente.' : 'Click Auto-Repair Coverage to automatically expand zone bounds.',
        isEs ? 'Ajusta manualmente lowKey y highKey en el Inspector de Zonas si prefieres particiones específicas.' : 'Manually adjust lowKey and highKey in Zone Inspector if custom splits are desired.'
      ],
      uiTargets: [{ targetId: 'btn-auto-repair', label: 'Auto-Reparar Cobertura' }],
    },
    {
      id: 'kb-import-methods',
      title: isEs ? 'Métodos de Importación de Muestras' : 'Sample Import Methods',
      tags: ['import', 'importar', 'archivos', 'sf2', 'sfz', 'convencion', 'samples'],
      whatItMeans: isEs
        ? 'Se admiten archivos individuales, convenciones de nombre por notas, y formatos universales de sampler.'
        : 'Supports individual files, filename note conventions, and universal sampler formats.',
      howToFixSteps: [
        isEs ? 'Import Samples (Ctrl+I) para ficheros sueltos.' : 'Import Samples (Ctrl+I) for individual files.',
        isEs ? 'Import by Name (Ctrl+N) para nombres estilo nombre_root_low_v1.' : 'Import by Name (Ctrl+N) for name_root_low_v1 conventions.',
        isEs ? 'Universal Import para SF2, SFZ, Kontakt NKI, DecentSampler, MPC XPM y discos Akai vintage.' : 'Universal Import for SF2, SFZ, Kontakt NKI, DecentSampler, MPC XPM, and Akai disks.'
      ],
      uiTargets: [{ targetId: 'nav-import-samples', label: 'Importar Muestras' }],
    },
    {
      id: 'kb-loop-editor',
      title: isEs ? 'Editor Interactivo de Bucle (Waveform Loop Editor)' : 'Waveform Loop Editor & Crossfade Seam',
      tags: ['loop', 'bucle', 'crossfade', 'cruces', 'clic', 'fade', 'editor'],
      whatItMeans: isEs
        ? 'Permite configurar el sostenido de las notas eliminando clics en las costuras.'
        : 'Configures sustain loop points, removing audible seam clicks.',
      howToFixSteps: [
        isEs ? 'Abre el Editor de Bucle (Ctrl+L) en la zona seleccionada.' : 'Open Loop Editor (Ctrl+L) for the active zone.',
        isEs ? 'Utiliza la búsqueda de cruce por cero (ncc_zc) y fundido cruzado de potencia constante.' : 'Use zero-crossing search (ncc_zc) and equal-power crossfade.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-loop-btn', label: 'Editor de Bucle' }],
    },
    {
      id: 'kb-audio-chopper',
      title: isEs ? 'Troceador de Audio y Auto-Slicer de Bucles' : 'Audio Chopper & Loop Slicer',
      tags: ['chopper', 'trocear', 'slicer', 'rex2', 'cortes', 'transitorios'],
      whatItMeans: isEs
        ? 'Segmenta pistas largas, tomas continuas o bucles REX2 en zonas independientes.'
        : 'Segments long takes or REX2 loops into independent MIDI zones.',
      howToFixSteps: [
        isEs ? 'Abre el Troceador de Audio desde el Inspector de Zonas.' : 'Open Audio Chopper from Zone Inspector.',
        isEs ? 'Ajusta la sensibilidad de transitorios para colocar los marcadores de corte.' : 'Adjust transient sensitivity to position slice markers.',
        isEs ? 'Confirma para repartir los trozos por el teclado MIDI.' : 'Apply to distribute slices across the MIDI keyboard.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-chop-btn', label: 'Troceador de Audio' }],
    },
    {
      id: 'kb-recorder-autosampler',
      title: isEs ? 'Grabadora de Audio y AutoSampler MIDI' : 'Audio Recorder & MIDI AutoSampler',
      tags: ['grabar', 'recorder', 'autosampler', 'ruido', 'hardware', 'midi'],
      whatItMeans: isEs
        ? 'Permite capturar fuentes acústicas con reducción de ruido determinista o muestrear sintetizadores externos.'
        : 'Captures microphones with noise reduction or auto-samples external hardware synths.',
      howToFixSteps: [
        isEs ? 'Usa la Grabadora de Audio para capturar micrófonos con huella de ruido.' : 'Use Audio Recorder to capture microphone takes with noise print.',
        isEs ? 'Configura el AutoSampler MIDI para enviar secuencias de notas y capturar capas de velocidad.' : 'Configure MIDI AutoSampler to send note sequences and record velocity layers.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-record-btn', label: 'Grabadora de Audio' }],
    },
    {
      id: 'kb-master-wave',
      title: isEs ? 'Estándar Master Wave (24-bit / 96 kHz)' : 'Master Wave Standard (24-bit / 96 kHz)',
      tags: ['master wave', '96k', '24bit', 'upsample', 'alta resolucion', 'hd'],
      whatItMeans: isEs
        ? 'Promueve las muestras al estándar 24-bit / 96 kHz mediante remuestreo polifásico sinc sincero.'
        : 'Upgrades samples to 24-bit / 96 kHz using sincere sinc polyphase resampling.',
      howToFixSteps: [
        isEs ? 'Pulsa Mejorar a Master Wave en el Inspector de Zonas.' : 'Click Upgrade to Master Wave in Zone Inspector.',
        isEs ? 'Preserva la imagen estéreo o envolvente quad original sin downmix forzado.' : 'Preserves stereo or quad spatial imaging without forced downmix.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-mw-btn', label: 'Mejorar a Master Wave' }],
    },
    {
      id: 'kb-spectral-view',
      title: isEs ? 'Analizador Espectral y Comparativa A/B' : 'Spectral View & A/B Resynthesis Audition',
      tags: ['espectro', 'spectral', 'analizador', 'parciales', 'a/b', 'resintesis'],
      whatItMeans: isEs
        ? 'Visualiza hasta 64 parciales coloreados y compara la señal original con la resíntesis aditiva del modelo.'
        : 'Renders up to 64 colored partials and compares original audio against additive resynthesis.',
      howToFixSteps: [
        isEs ? 'Activa el Visor Espectral en la barra de herramientas o inspector.' : 'Enable Spectral View from the toolbar or inspector.',
        isEs ? 'Conmuta entre Original y Resíntesis para verificar la fidelidad tímbrica.' : 'Toggle between Original and Resynthesis to evaluate timbre fidelity.'
      ],
    },
    {
      id: 'kb-cover-artwork',
      title: isEs ? 'Generación de Portadas de Modelo (cover.webp)' : 'Model Cover Artwork (cover.webp)',
      tags: ['cover', 'portada', 'arte', 'imagen', 'procedural', 'byok'],
      whatItMeans: isEs
        ? 'Crea portadas 512x512 para el modelo de forma offline procedural o mediante Cloud BYOK.'
        : 'Creates 512x512 model artwork offline procedurally or via Cloud BYOK.',
      howToFixSteps: [
        isEs ? 'Usa el generador Procedural Acústico gratuito basado en los parciales de la muestra.' : 'Use the free Acoustic Procedural generator based on sample harmonics.',
        isEs ? 'Opcionalmente conecta una API Key propia (DALL-E 3, Imagen 3, Flux).' : 'Optionally connect your own API Key (DALL-E 3, Imagen 3, Flux).'
      ],
      uiTargets: [{ targetId: 'process-cover-box', label: 'Portada del Modelo' }],
    },
    {
      id: 'kb-axionikdb-export',
      title: isEs ? 'Exportación a AxionikDB y Formatos Sampler' : 'AxionikDB Export & Sampler Formats',
      tags: ['export', 'exportar', 'axionikdb', 'zip', 'sfz', 'guardar'],
      whatItMeans: isEs
        ? 'Permite guardar el modelo compilado en la base de datos local o empaquetar en ZIP y formatos de sampler.'
        : 'Saves compiled models into local database or packages into ZIP and sampler formats.',
      howToFixSteps: [
        isEs ? 'Guarda directamente en AxionikDB mediante el Companion Bridge (:7860).' : 'Save directly into AxionikDB via Companion Bridge (:7860).',
        isEs ? 'Descarga el ZIP de 5 capas de la Cápsula del Tiempo o exporta a SFZ / DecentSampler / MPC.' : 'Download 5-layer Time Capsule ZIP or export to SFZ / DecentSampler / MPC.'
      ],
      uiTargets: [{ targetId: 'nav-compile-btn', label: 'Compilar y Exportar' }],
    },
    {
      id: 'kb-local-bridge-ollama',
      title: isEs ? 'Configuración de LLM Local y Companion Bridge' : 'Local LLM & Companion Bridge Configuration',
      tags: ['ollama', 'lmstudio', 'bridge', 'servidor', 'local', 'privacidad'],
      whatItMeans: isEs
        ? 'Soporte para inferencia 100% privada con Ollama (:11434) o LM Studio (:1234) y puente local Python (:7860).'
        : 'Supports 100% private inference with Ollama (:11434) or LM Studio (:1234) and Python bridge (:7860).',
      howToFixSteps: [
        isEs ? 'Abre Ajustes (Ctrl+,) y configura la URL de Ollama o LM Studio.' : 'Open Settings (Ctrl+,) and configure Ollama or LM Studio URL.',
        isEs ? 'Inicia el Companion Bridge local con python bridge/server.py para acceso nativo al disco.' : 'Launch local Companion Bridge with python bridge/server.py for native filesystem access.'
      ],
      uiTargets: [{ targetId: 'nav-ai-status-pill', label: 'Estado IA' }],
    },
    {
      id: 'kb-honesty-limits',
      title: isEs ? 'Alcance y Límites del Sistema (Honestidad Técnica)' : 'Scope & Architectural Boundaries (AI Honesty)',
      tags: ['limites', 'alcance', 'daw', 'vst', 'que no hace', 'honestidad'],
      whatItMeans: isEs
        ? 'ABDNeuModMakr se especializa en análisis y compilación de modelos neuronales; no es un DAW multipista.'
        : 'ABDNeuModMakr specializes in neural model analysis and compilation; it is not a multi-track DAW.',
      howToFixSteps: [
        isEs ? 'No admite mezcla multipista ni secuenciador piano-roll de pistas completas.' : 'Does not support multitrack mixing or full arrangement piano-rolls.',
        isEs ? 'No aloja plugins VST3 externos; su objetivo es generar modelos para Hartmann Neuron y ABDAxionikVS.' : 'Does not host external VST3 plugins; its purpose is generating models for Hartmann Neuron and ABDAxionikVS.'
      ],
    }
  ];
}

export function buildNeuronSystemPrompt(locale: 'es' | 'en' = 'es'): string {
  const isEs = locale === 'es';
  const targets = CANONICAL_UI_TARGETS.join(', ');

  if (isEs) {
    return `Eres el Asistente Experto de ABDNeuModMakr y del sintetizador Hartmann Neuron / ABDAxionikVS.
Tu objetivo es guiar al usuario en la creación, mapeo, edición de bucles, análisis acústico y compilación de modelos espectrales.

DIRECTRICES OBLIGATORIAS:
1. Responde EXCLUSIVAMENTE con un único objeto JSON válido con la siguiente estructura:
{
  "reply": "Texto de explicación claro y conciso en español. Puedes usar markdown seguro (**negrita**, \`codigo\`) y enlaces visuales [[target:TARGET_ID|Etiqueta del Control]].",
  "highlightTargets": ["TARGET_ID_1"],
  "proposedActions": [
    {
      "actionName": "nombre_herramienta",
      "description": "Explicación breve de lo que hará esta acción",
      "args": { ... }
    }
  ]
}

2. NUNCA inventes herramientas, menús ni características no existentes. Solo puedes sugerir herramientas registradas en el catálogo.
3. Para señalar controles en la pantalla, incluye solo identificadores válidos en highlightTargets de esta lista:
[${targets}]
4. Si el usuario pide algo fuera del alcance de ABDNeuModMakr (como mezcla de audio multipista o plugins VST), responde con honestidad explicando qué es y qué no es la aplicación.
5. Mantén respuestas concisas, profesionales y técnicamente precisas.`;
  }

  return `You are the Expert Copilot for ABDNeuModMakr and the Hartmann Neuron / ABDAxionikVS synthesizer.
Your goal is to guide the user through sample mapping, loop editing, acoustic analysis, and neural model compilation.

MANDATORY GUIDELINES:
1. Respond EXCLUSIVELY with a single valid JSON object structured as:
{
  "reply": "Clear, concise response in English. You may use markdown (**bold**, \`code\`) and visual spotlight chips [[target:TARGET_ID|Control Label]].",
  "highlightTargets": ["TARGET_ID_1"],
  "proposedActions": [
    {
      "actionName": "tool_name",
      "description": "Brief summary of the proposed action",
      "args": { ... }
    }
  ]
}

2. NEVER invent non-existent tools, menus, or features. Only propose actions that exist in the tool catalog.
3. To spotlight UI elements, use only valid IDs in highlightTargets from this list:
[${targets}]
4. If the user asks for out-of-scope DAW operations (like multi-track mixing or VST plugins), answer honestly explaining application boundaries.
5. Keep explanations direct, technical, and musically helpful.`;
}
