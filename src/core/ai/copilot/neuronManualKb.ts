// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Application & Hartmann Neuron Manual Knowledge Base
// Comprehensive manual covering all menus, workflows, tools, formats & DSP
// Optimized for human search (natural query terms) and LLM grounding (BM25)
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
  'nav-spectral-btn',
  'nav-theme-btn',
  'nav-settings-btn',
  'process-working-mode',
  'process-model-name',
  'process-param-set',
  'process-complexity',
  'process-dsp-algo',
  'process-cover-box',
  'process-start-btn',
  'process-export-btn',
  'zone-inspector-root',
  'zone-inspector-split-btn',
  'zone-inspector-delete-btn',
  'zone-inspector-loop-btn',
  'zone-inspector-chop-btn',
  'zone-inspector-record-btn',
  'zone-inspector-mw-btn',
  'workspace-zone-ribbon',
  'workspace-keyboard-strip',
  'btn-auto-repair'
] as const;

export function getNeuronKnowledgeBase(locale: 'es' | 'en' = 'es'): KbArticle[] {
  const isEs = locale === 'es';

  return [
    // 1. FLUJO DE TRABAJO Y PRIMEROS PASOS
    {
      id: 'kb-workflow-start',
      title: isEs ? '¿Cómo creo mi primer modelo? (Flujo de Trabajo Principal)' : 'How do I create my first model? (Core Workflow)',
      tags: ['workflow', 'inicio', 'primer', 'modelo', 'empezar', 'comenzar', 'pasos', 'flujo', 'crear', 'tutorial', 'start', 'guide', 'aplicacion', 'app', 'nuevo'],
      whatItMeans: isEs
        ? 'El proceso para crear un instrumento en ABDNeuModMakr se divide en 3 pasos sencillos: cargar muestras de audio, organizar las zonas en el teclado MIDI y generar el modelo espectral.'
        : 'Creating an instrument in ABDNeuModMakr follows 3 simple steps: load audio samples, arrange zones on the MIDI keyboard, and generate the spectral model.',
      howToFixSteps: [
        isEs ? 'Paso 1 (Cargar Audio): Usa el botón Asistente para Músicos (guiado) o ve a Archivo > Importación Inteligente Universal (Ctrl+I) para cargar WAV, AIFF, FLAC, SF2 o SFZ.' : 'Step 1 (Load Audio): Use the Musician Wizard or File > Universal Smart Import (Ctrl+I) to load WAV, AIFF, FLAC, SF2, or SFZ.',
        isEs ? 'Paso 2 (Mapear y Ajustar): Revisa en la tabla central y en la Cinta de Zonas que el teclado 0..127 esté cubierto sin huecos, y elige el Parameter Set (tipo de instrumento) y la Complejidad.' : 'Step 2 (Map & Tune): Verify full 0..127 keyboard coverage in the Zone Table and Ribbon, and select Parameter Set and Complexity.',
        isEs ? 'Paso 3 (Compilar y Guardar): Pulsa Generar Modelo Neuron (Ctrl+P) en el panel izquierdo para analizar el espectro y exportarlo a Cápsula del Tiempo (.zip), AxionikDB o sampler.' : 'Step 3 (Compile & Save): Click Generate Neuron Model (Ctrl+P) to run spectral analysis and export to Time Capsule (.zip), AxionikDB, or sampler.'
      ],
      uiTargets: [
        { targetId: 'nav-musician-wizard', label: isEs ? 'Abrir Asistente para Músicos' : 'Open Musician Wizard' },
        { targetId: 'nav-import-samples', label: isEs ? 'Importar Muestras' : 'Import Samples' },
        { targetId: 'process-start-btn', label: isEs ? 'Generar Modelo' : 'Generate Model' }
      ],
    },

    // 2. ASISTENTE PARA MÚSICOS
    {
      id: 'kb-musician-wizard',
      title: isEs ? 'Asistente para Músicos (Creación Guiada en 4 Pasos)' : 'Musician Wizard (4-Step Guided Creation)',
      tags: ['wizard', 'asistente', 'musicos', 'guiado', 'novato', 'paso a paso', 'facil', 'rapido', 'ayuda', 'automatico', 'ctrl+shift+w'],
      whatItMeans: isEs
        ? 'El Asistente para Músicos permite crear un modelo completo en 4 pasos sin necesidad de configurar parámetros técnicos de síntesis espectral.'
        : 'The Musician Wizard builds a complete model in 4 guided steps without requiring deep technical synthesis knowledge.',
      howToFixSteps: [
        isEs ? 'Paso 1 (Material): Graba con micrófono, muestrea un sinte externo o arrastra tus archivos de audio o bancos SF2/SFZ.' : 'Step 1 (Material): Record via mic, auto-sample hardware, or drop audio files / SF2 / SFZ banks.',
        isEs ? 'Paso 2 (Intención Musical): Elige qué familia de sonido buscas (Pad, Lead, Bajo, Teclado, Cuerda, Batería) y el asistente ajustará Parameter Set y Complejidad.' : 'Step 2 (Musical Intent): Pick your sound family (Pad, Lead, Bass, Keys, Strings, Drums) to auto-configure Parameter Set and Complexity.',
        isEs ? 'Paso 3 y 4 (Revisión y Destino): Escucha el resultado y guárdalo directamente en AxionikDB o descárgalo en ZIP.' : 'Steps 3 & 4 (Review & Export): Audition the result and save directly to AxionikDB or download as ZIP.'
      ],
      uiTargets: [{ targetId: 'nav-musician-wizard', label: isEs ? 'Asistente para Músicos' : 'Musician Wizard' }],
    },

    // 3. GESTIÓN DE SESIONES (.nmsession.json)
    {
      id: 'kb-session-management',
      title: isEs ? 'Guardar, Abrir y Reiniciar Proyecto o Sesión (.nmsession.json)' : 'Save, Open & Reset Project Session (.nmsession.json)',
      tags: ['sesion', 'proyecto', 'guardar', 'abrir', 'cargar', 'reiniciar', 'nuevo', 'borrar', 'empezar de cero', 'nmsession', 'json', 'ctrl+s', 'ctrl+o'],
      whatItMeans: isEs
        ? 'Una Sesión (.nmsession.json) guarda todo tu trabajo en curso (zonas, muestras cargadas, bucles y ajustes) para continuar editándolo más tarde sin perder nada.'
        : 'A Session (.nmsession.json) saves your entire work-in-progress (zones, audio samples, loops, and settings) so you can resume editing later.',
      howToFixSteps: [
        isEs ? 'Nueva Sesión: Ve a Archivo > Nueva Sesión (Reiniciar) para limpiar el proyecto actual y empezar desde cero.' : 'New Session: Go to File > New Session (Reset) to clear current work and start fresh.',
        isEs ? 'Guardar Sesión: Pulsa Ctrl+S (Archivo > Guardar > Guardar Sesión) o Ctrl+Shift+S para guardar con otro nombre.' : 'Save Session: Press Ctrl+S (File > Save > Save Session) or Ctrl+Shift+S to Save As.',
        isEs ? 'Abrir Sesión: Pulsa Ctrl+O (Archivo > Abrir Sesión) y selecciona tu archivo .nmsession.json.' : 'Open Session: Press Ctrl+O (File > Open Session) and select your .nmsession.json file.'
      ],
      uiTargets: [{ targetId: 'process-model-name', label: isEs ? 'Identidad del Proyecto' : 'Project Identity' }],
    },

    // 4. MÉTODOS DE IMPORTACIÓN DE AUDIO Y SAMPLERS
    {
      id: 'kb-import-methods',
      title: isEs ? 'Importar Audio, Carpetas, SoundFonts (SF2/SFZ) e Imágenes ISO/Akai' : 'Import Audio, Folders, SoundFonts (SF2/SFZ) & Akai/ISO Disks',
      tags: ['import', 'importar', 'cargar', 'meter', 'audio', 'wav', 'aiff', 'flac', 'mp3', 'ogg', 'sf2', 'sfz', 'soundfont', 'akai', 'iso', 'nki', 'kontakt', 'mpc', 'xpm', 'decentsampler', 'carpeta', 'nombre', 'ctrl+i', 'ctrl+n'],
      whatItMeans: isEs
        ? 'ABDNeuModMakr incluye un motor de importación universal capaz de leer muestras sueltas, carpetas organizadas por nota y bancos completos de samplers clásicos y modernos.'
        : 'ABDNeuModMakr features a universal import engine for loose audio files, note-named folders, and complete legacy or modern sampler banks.',
      howToFixSteps: [
        isEs ? 'Importación Inteligente Universal (Ctrl+I): Detecta automáticamente si entregas muestras WAV/AIFF/FLAC, paquetes ZIP o bancos multi-instrumento.' : 'Universal Smart Import (Ctrl+I): Automatically detects loose WAV/AIFF/FLAC files, ZIP archives, or multi-instrument banks.',
        isEs ? 'Importar por Nombre (Ctrl+N): Lee archivos con nomenclatura tipo Instrumento_C3_v127.wav y asigna automáticamente nota raíz, rango de teclas y velocidad.' : 'Import by Name (Ctrl+N): Parses filenames like Instrument_C3_v127.wav and auto-assigns root key, key range, and velocity.',
        isEs ? 'Importar Sampler / Imagen de Disco: En Archivo > Importar Formatos Específicos, carga directamente archivos .sf2, .sfz, Kontakt (.nki), Akai (.iso, .akp), Logic (.exs) o MPC (.xpm).' : 'Import Sampler / Disk Image: Under File > Import Specific Formats, load .sf2, .sfz, Kontakt (.nki), Akai (.iso, .akp), Logic (.exs), or MPC (.xpm).'
      ],
      uiTargets: [{ targetId: 'nav-import-samples', label: isEs ? 'Importar Muestras (Ctrl+I)' : 'Import Samples (Ctrl+I)' }],
    },

    // 5. IMPORTAR MODELOS EXISTENTES DE NEURON
    {
      id: 'kb-import-existing-models',
      title: isEs ? 'Abrir y Reconstruir Modelos Existentes (.model, .nmmodel o .zip)' : 'Open & Reconstruct Existing Models (.model, .nmmodel, or .zip)',
      tags: ['abrir modelo', 'importar modelo', 'model', 'nmmodel', 'zip', 'capsula', 'reconstruir', 'editar modelo', 'decompile', 'inverir', 'resintetizar'],
      whatItMeans: isEs
        ? 'Puedes abrir modelos antiguos del hardware Hartmann Neuron (<NNN>.model) o Cápsulas del Tiempo (.zip / .nmmodel) para inspeccionarlos, re-sintetizarlos o convertirlos.'
        : 'You can open legacy Hartmann Neuron hardware models (<NNN>.model) or Time Capsules (.zip / .nmmodel) to inspect, re-process, or convert them.',
      howToFixSteps: [
        isEs ? 'Desde Carpeta (<NNN>.model): Ve a Archivo > Importar Formatos Específicos > Importar Carpeta de Modelo y elige la carpeta que contiene Model.scape y Model.sphere.' : 'From Folder (<NNN>.model): Go to File > Import Specific Formats > Import Model Folder and select the directory containing Model.scape and Model.sphere.',
        isEs ? 'Desde Cápsula ZIP: Si el archivo incluye las muestras fuente (Capas 4 y 5), puedes pulsar Reprocesar desde Fuente Pura para recalcular el modelo con mayor resolución.' : 'From Time Capsule ZIP: If source audio layers are present, you can reprocess from purest source at higher resolution.'
      ],
      uiTargets: [{ targetId: 'nav-bank-btn', label: isEs ? 'Navegador NeuronDB' : 'NeuronDB Browser' }],
    },

    // 6. NAVEGADOR DE BANCOS NEURONDB Y AXIONIKDB
    {
      id: 'kb-neurondb-browser',
      title: isEs ? 'Navegador de Librería NeuronDB y AxionikDB (Ctrl+B)' : 'NeuronDB & AxionikDB Library Browser (Ctrl+B)',
      tags: ['banco', 'libreria', 'biblioteca', 'neurondb', 'axionikdb', 'explorar', 'buscar modelos', 'presets', 'sounds', 'coleccion', 'ctrl+b'],
      whatItMeans: isEs
        ? 'El cajón lateral de librería permite explorar todos los modelos instalados en tu disco local (NeuronDB y AxionikDB), escucharlos y cargarlos en un clic.'
        : 'The library drawer lets you browse all models installed on your local drive (NeuronDB and AxionikDB), audition them, and load them with one click.',
      howToFixSteps: [
        isEs ? 'Pulsa el icono de base de datos en la barra superior o el atajo Ctrl+B (Vista > Navegador de Banco NeuronDB).' : 'Click the database icon in the top bar or press Ctrl+B (View > NeuronDB Bank Browser).',
        isEs ? 'Para cambiar la ruta de tu carpeta de modelos en disco, usa Archivo > Configurar Carpeta de Librería NeuronDB o Ajustes (Ctrl+,).' : 'To change your local library folder path, use File > Configure NeuronDB Library Folder or Settings (Ctrl+,).'
      ],
      uiTargets: [{ targetId: 'nav-bank-btn', label: isEs ? 'Abrir Librería (Ctrl+B)' : 'Open Library (Ctrl+B)' }],
    },

    // 7. MODOS DE TRABAJO: CLÁSICO VS EXTENDIDO
    {
      id: 'kb-modes-classic-extended',
      title: isEs ? 'Diferencia entre Modo Clásico (Hardware 1:1) y Modo Extendido (HD Multi-Capa)' : 'Difference between Classic Mode (1:1 Hardware) & Extended Mode (HD)',
      tags: ['classic', 'clasico', 'extended', 'extendido', 'diferencia', 'modo', 'comparar', 'v2', 'capsula', 'neuronvs', 'axionikvs', 'hd', 'hardware'],
      whatItMeans: isEs
        ? 'El Modo Clásico mantiene compatibilidad estricta 1:1 con el sintetizador físico Hartmann Neuron de 2002; el Modo Extendido desbloquea las mejoras de alta definición para ABDAxionikVS.'
        : 'Classic Mode enforces strict 1:1 compatibility with the 2002 Hartmann Neuron hardware; Extended Mode unlocks high-definition capabilities for ABDAxionikVS.',
      howToFixSteps: [
        isEs ? 'Modo Clásico: Audio a 44.1 kHz, máximo 64 parciales armónicos, nombre ASCII de 11 caracteres, 1 dimensión de teclado (0..127 sin huecos) y hasta 2 capas de velocidad (Low/High).' : 'Classic Mode: 44.1 kHz audio, 64 partials max, 11-char ASCII name, contiguous 0..127 key splits, and up to 2 velocity layers (Low/High).',
        isEs ? 'Modo Extendido: Audio Master Wave 24-bit / 96 kHz, matriz 2D libre de Tecla x Velocidad, Round-Robin, envolvente espectral Bark, residuo estocástico DDSP, Surround Quad 4.0 y portada artística.' : 'Extended Mode: 24-bit / 96 kHz Master Wave, 2D Key x Velocity matrix, Round-Robin, Bark spectral envelope, DDSP stochastic residual, Quad 4.0 Surround, and cover art.'
      ],
      uiTargets: [{ targetId: 'process-working-mode', label: isEs ? 'Cambiar Modo de Trabajo' : 'Switch Working Mode' }],
    },

    // 8. TABLA DE ZONAS, CINTA 2D Y MAPEO CROMÁTICO VS BATERÍA GM
    {
      id: 'kb-zone-table-and-ribbon',
      title: isEs ? 'Mapeo de Teclas, Capas de Velocidad y Modo Batería General MIDI (GM Drum)' : 'Key Mapping, Velocity Splits & General MIDI Drum Mode (GM Drum)',
      tags: ['zonas', 'regiones', 'tabla', 'cinta', 'ribbon', 'mapear', 'dividir', 'partir', 'split', 'teclas', 'velocidad', 'velocity', 'bateria', 'drum', 'gm', 'cromatico', 'nota raiz', 'root key', 'afinacion', 'detune', 'volumen', 'pan'],
      whatItMeans: isEs
        ? 'La tabla central y la Cinta de Zonas (ZoneRibbon) muestran cómo se reparten tus muestras a lo largo del teclado MIDI (notas 0 C-2 a 127 G8) y por intensidad de pulsación (velocidad 1..127).'
        : 'The central table and ZoneRibbon display how your audio samples are distributed across the MIDI keyboard (0 C-2 to 127 G8) and velocity layers (1..127).',
      howToFixSteps: [
        isEs ? 'Añadir o Dividir Zona: Pulsa + Nueva Zona (tecla Insert) o arrastra los bordes verticales en la Cinta de Zonas inferior.' : 'Add or Split Zone: Click + New Zone (Insert key) or drag vertical borders in the lower Zone Ribbon.',
        isEs ? 'Eliminar Zona: Selecciona una fila y pulsa Eliminar Zona (tecla Supr/Delete); las zonas vecinas se expandirán para no dejar huecos.' : 'Delete Zone: Select a row and click Remove Zone (Delete key); neighbor zones expand automatically.',
        isEs ? 'Modo Cromático vs Mapa Batería GM: En la barra superior de la tabla, conmuta entre Cromático (instrumentos melódicos) y Mapa Batería GM (asigna cada golpe a su nota estándar General MIDI y detecta colisiones).' : 'Chromatic vs GM Drum Map: Use the toggle above the table to switch between pitched instruments and General MIDI Drum piece mapping.'
      ],
      uiTargets: [
        { targetId: 'workspace-zone-ribbon', label: isEs ? 'Cinta de Zonas 2D' : '2D Zone Ribbon' },
        { targetId: 'zone-inspector-split-btn', label: isEs ? 'Nueva Zona' : 'New Zone' }
      ],
    },

    // 9. COBERTURA MIDI Y REPARACIÓN DE HUECOS
    {
      id: 'kb-coverage-gaps',
      title: isEs ? 'Error de Cobertura MIDI: Huecos o Solapes en el Teclado (0..127)' : 'MIDI Coverage Error: Keyboard Gaps or Overlaps (0..127)',
      tags: ['cobertura', 'gaps', 'huecos', 'solapes', 'overlap', 'error', 'teclado', 'incompleto', 'auto-repair', 'reparar', 'arreglar', 'midi', '128 teclas'],
      whatItMeans: isEs
        ? 'El motor clásico de Hartmann exige que las 128 notas MIDI (de la nota 0 a la 127) estén cubiertas de forma continua sin notas vacías ni solapamientos.'
        : 'The classic Hartmann engine requires all 128 MIDI notes (0 through 127) to be contiguously covered without empty gaps or overlaps.',
      howToFixSteps: [
        isEs ? 'Haz clic en la píldora de cobertura de la barra superior o en Editar > Auto-Reparar Cobertura MIDI para que la aplicación estire los límites automáticamente.' : 'Click the top bar coverage pill or Edit > Auto-Repair MIDI Coverage to automatically stretch zone boundaries.',
        isEs ? 'También puedes editar manualmente Tecla Inf (lowKey) y Tecla Sup (highKey) directamente en la tabla de zonas.' : 'You can also manually edit Low Key and High Key directly in the zone table.'
      ],
      uiTargets: [{ targetId: 'btn-auto-repair', label: isEs ? 'Auto-Reparar Cobertura' : 'Auto-Repair Coverage' }],
    },

    // 10. AUTO-DETECCIÓN ACÚSTICA (PITCH F0 E INSTRUMENTO)
    {
      id: 'kb-acoustic-autodetect',
      title: isEs ? 'Detección Automática de Nota Raíz (Pitch F0) y Clasificación de Instrumento' : 'Automatic Root Pitch (F0) Detection & Instrument Classification',
      tags: ['f0', 'pitch', 'tono', 'nota', 'afinar', 'detectar', 'autodetectar', 'reconocer', 'frecuencia', 'cents', 'desafinacion', 'inteligencia acustica'],
      whatItMeans: isEs
        ? 'El motor DSP analiza cada muestra mediante autocorrelación YIN y descriptores espectrales para detectar su nota musical exacta (MIDI Root Key), desviación en cents y familia de instrumento.'
        : 'The DSP engine analyzes each sample using YIN autocorrelation and spectral descriptors to detect its exact MIDI Root Key, cent offset, and instrument family.',
      howToFixSteps: [
        isEs ? 'Al importar cualquier muestra, la detección de tono y sugerencia de Parameter Set se ejecuta automáticamente.' : 'When importing samples, pitch detection and Parameter Set recommendation run automatically.',
        isEs ? 'Para volver a analizar una zona concreta, abre el Cajón de Edición de Zona (icono de engranaje en la fila o Ctrl+J) y pulsa Auto-Detectar Tono y Set.' : 'To re-analyze a specific zone, open the Zone Editor Drawer (row gear icon or Ctrl+J) and click Auto-Detect Pitch & Set.'
      ],
      uiTargets: [{ targetId: 'process-param-set', label: isEs ? 'Ver Parameter Set' : 'View Parameter Set' }],
    },

    // 11. LOS 10 PARAMETER SETS CANÓNICOS
    {
      id: 'kb-parameter-sets',
      title: isEs ? '¿Qué Parameter Set (0..9) debo elegir para mi instrumento?' : 'Which Parameter Set (0..9) should I choose for my instrument?',
      tags: ['parameter set', 'conjunto', 'parametros', 'timbre', 'clasificacion', 'categoria', 'indices', 'cuerdas', 'pads', 'bajo', 'teclado', 'vientos', 'campanas', 'bateria', 'sfx'],
      whatItMeans: isEs
        ? 'El Parameter Set (0 a 9) define qué características acústicas controlarán los ejes X/Y de los joysticks Scape (excitación) y Sphere (resonador) en el sintetizador.'
        : 'The Parameter Set (0 to 9) defines which acoustic traits are mapped to the X/Y axes of the Scape (excitation) and Sphere (resonator) sticks.',
      howToFixSteps: [
        isEs ? '0 (Synth & Neutral): Ondas electrónicas, leads analógicos y timbres puros.' : '0 (Synth & Neutral): Electronic waves, analog leads, and pure timbres.',
        isEs ? '1 (Strings / Winds & Brass) y 5 (Winds & Voice): Cuerdas frotadas, metales, maderas y coros/voces.' : '1 (Strings / Winds & Brass) & 5 (Winds & Voice): Bowed strings, brass, woodwinds, and vocals.',
        isEs ? '2 (Keyboards), 3 (Plucked) y 4 (Bass): Pianos/órganos, guitarras/arpas pulsadas y bajos acústicos o sintéticos.' : '2 (Keyboards), 3 (Plucked) & 4 (Bass): Pianos/organs, plucked guitars/harps, and basses.',
        isEs ? '6 (Pads & Textures), 7 (Mallets & Bells), 8 (Drums & Loops) y 9 (SFX): Atmósferas evolutivas, percusión tonal/campanas, ritmos y efectos especiales.' : '6 (Pads & Textures), 7 (Mallets & Bells), 8 (Drums & Loops) & 9 (SFX): Evolving pads, bells, rhythm loops, and sound effects.'
      ],
      uiTargets: [{ targetId: 'process-param-set', label: isEs ? 'Configurar Parameter Set' : 'Configure Parameter Set' }],
    },

    // 12. COMPLEJIDAD Y PROFUNDIDAD DE TRAMAS (recDepth)
    {
      id: 'kb-complexity-recdepth',
      title: isEs ? 'Complejidad Espectral (Niveles 1..10) y Tramas Temporales (recDepth)' : 'Spectral Complexity (Levels 1..10) & Frame Depth (recDepth)',
      tags: ['complexity', 'complejidad', 'recdepth', 'tramas', 'frames', 'resolucion', 'calidad', 'memoria', 'tamano', 'evolucion'],
      whatItMeans: isEs
        ? 'La Complejidad (1 a 10) determina cuántas instantáneas espectrales en el tiempo (de 1 a 64 tramas: [1, 4, 8, 12, 16, 24, 32, 42, 54, 64]) se almacenan para recrear la evolución del sonido.'
        : 'Complexity (1 to 10) sets how many temporal spectral snapshots (1 to 64 frames: [1, 4, 8, 12, 16, 24, 32, 42, 54, 64]) are stored to capture sound evolution.',
      howToFixSteps: [
        isEs ? 'Complejidad Baja (1..4, 1 a 12 tramas): Ideal para percusión seca, golpes cortos o ondas estáticas; genera modelos muy ligeros.' : 'Low Complexity (1..4, 1 to 12 frames): Ideal for dry percussion, one-shots, or static waves; yields compact models.',
        isEs ? 'Complejidad Media (5..7, 16 a 32 tramas): Equilibrio recomendado para pianos, guitarras, bajos y metales.' : 'Medium Complexity (5..7, 16 to 32 frames): Recommended balance for pianos, guitars, basses, and brass.',
        isEs ? 'Complejidad Alta (8..10, 42 a 64 tramas): Máximo detalle para pads complejos, texturas cambiantes y muestras largas.' : 'High Complexity (8..10, 42 to 64 frames): Maximum detail for evolving pads, textures, and long samples.'
      ],
      uiTargets: [{ targetId: 'process-complexity', label: isEs ? 'Ajustar Complejidad' : 'Adjust Complexity' }],
    },

    // 13. MOTOR DSP: CLÁSICO (NASAnalysis 1:1) VS ENHANCED HD
    {
      id: 'kb-dsp-algorithm',
      title: isEs ? 'Motor de Análisis DSP: Clásico (NASAnalysis 1:1) vs Mejorado (Enhanced)' : 'DSP Analysis Engine: Classic (NASAnalysis 1:1) vs Enhanced',
      tags: ['dsp', 'algoritmo', 'nasanalysis', 'legacy', 'enhanced', 'mejorado', 'analisis', 'parciales', 'resintesis', 'fidelidad'],
      whatItMeans: isEs
        ? 'Permite elegir entre la réplica matemática exacta de la librería NASAnalysis.dll original de 2002 o el algoritmo mejorado con seguimiento de fase y resolución extendida.'
        : 'Lets you choose between the exact mathematical replica of the 2002 NASAnalysis.dll or the enhanced algorithm with phase tracking and extended resolution.',
      howToFixSteps: [
        isEs ? 'Haz clic en la tarjeta 2. Motor de Resíntesis del panel izquierdo o pulsa Ctrl+M (Configurar Modelo > Articulación y Síntesis).' : 'Click card 2. Resynthesis Engine in the left panel or press Ctrl+M (Model Settings > Articulation & Synthesis).',
        isEs ? 'Usa Clásico (Legacy) si buscas el carácter granulado original del hardware Neuron; usa Mejorado (Enhanced) para transitorios más limpios y menor ruido de fase.' : 'Use Classic (Legacy) for authentic vintage Neuron grain; use Enhanced for cleaner transients and lower phase noise.'
      ],
      uiTargets: [{ targetId: 'process-dsp-algo', label: isEs ? 'Configurar Motor DSP' : 'Configure DSP Engine' }],
    },

    // 14. CONCEPTO SCAPE, SPHERE Y SOUND
    {
      id: 'kb-scape-vs-sphere',
      title: isEs ? '¿Qué son Model.scape, Model.sphere y Sound.script en Hartmann Neuron?' : 'What are Model.scape, Model.sphere & Sound.script in Hartmann Neuron?',
      tags: ['scape', 'sphere', 'sound', 'script', 'snddat', 'diferencia', 'estructura', 'archivos', 'hartmann', 'excitador', 'resonador'],
      whatItMeans: isEs
        ? 'Hartmann Neuron separa cada instrumento en el Modelo acústico (dividido en excitador .scape y resonador .sphere) y el preset de articulación (.sound).'
        : 'Hartmann Neuron separates each instrument into the acoustic Model (split into .scape exciter and .sphere resonator) and the articulation preset (.sound).',
      howToFixSteps: [
        isEs ? 'Model.scape: Contiene los parámetros de cómo se produce el sonido (ataque, soplo, golpe, contenido inarmónico y evolución temporal).' : 'Model.scape: Holds excitation parameters (attack, breath, strike, inharmonicity, and temporal evolution).',
        isEs ? 'Model.sphere: Contiene la respuesta resonante del cuerpo acústico (tamaño de cavidad, formantes y brillo espectral).' : 'Model.sphere: Holds resonant body response (cavity size, formants, and spectral brightness).',
        isEs ? 'Sound / SndDat: Define la posición de los joysticks Silver Stick, filtros, LFOs y efectos que modulan el modelo.' : 'Sound / SndDat: Defines Silver Stick positions, filters, LFOs, and effects modulating the model.'
      ],
    },

    // 15. EDITOR INTERACTIVO DE BUCLES (LOOP EDITOR)
    {
      id: 'kb-loop-editor',
      title: isEs ? 'Editor de Bucles (Quitar Clics, Cruce por Cero y Crossfade)' : 'Loop Editor (Remove Clicks, Zero-Crossing & Crossfade Seam)',
      tags: ['loop', 'bucle', 'sustain', 'sostenido', 'crossfade', 'fundido', 'cruces por cero', 'zero crossing', 'clic', 'chasquido', 'pop', 'costura', 'infinito', 'autoloop'],
      whatItMeans: isEs
        ? 'El Editor de Bucles permite hacer que una nota suene indefinidamente al mantener pulsada una tecla, eliminando chasquidos en el punto de unión mediante búsqueda de cruce por cero y fundido cruzado.'
        : 'The Loop Editor enables infinite sustain while holding a key, eliminating seam clicks via zero-crossing search and equal-power crossfading.',
      howToFixSteps: [
        isEs ? 'Abre el Editor de Bucles desde el botón Herramientas > Editor de Bucles de la tabla de zonas o desde Modelo > Herramientas > Editor de Bucles.' : 'Open the Loop Editor via Tools > Loop Editor in the zone table or Model > Tools > Loop Editor.',
        isEs ? 'Pulsa Buscar Bucle Óptimo (Auto-Find) usando el algoritmo NCC + Cruce por Cero para localizar automáticamente el tramo más estable.' : 'Click Auto-Find Loop using the NCC + Zero-Crossing algorithm to automatically locate the most stable sustain region.',
        isEs ? 'Si aún percibes un leve clic en la transición, sube el deslizador de Crossfade (fundido cruzado de potencia constante) y activa Preescucha con Bucle.' : 'If a slight click remains at the seam, increase the Crossfade slider and audition with Loop Playback enabled.',
        isEs ? 'Para aplicar bucles automáticos a todo el instrumento de una vez, usa Herramientas > Auto-Bucle en Todas las Zonas.' : 'To auto-loop all zones at once, use Tools > Auto-Loop All Zones.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-loop-btn', label: isEs ? 'Abrir Editor de Bucles' : 'Open Loop Editor' }],
    },

    // 16. TROCEADOR DE AUDIO Y AUTO-SLICER (CHOPPER)
    {
      id: 'kb-audio-chopper',
      title: isEs ? 'Troceador de Audio y Auto-Slicer (Cortar Grabaciones Largas o Bucles REX2)' : 'Audio Chopper & Auto-Slicer (Slice Long Takes or REX2 Loops)',
      tags: ['chopper', 'troceador', 'trocear', 'cortar', 'dividir audio', 'slicer', 'autoslicer', 'rex', 'rex2', 'rx2', 'recycle', 'cue', 'transitorios', 'golpes', 'bateria', 'frase'],
      whatItMeans: isEs
        ? 'El Troceador (Audio Chopper) detecta automáticamente cada nota o golpe de percusión dentro de una grabación larga y reparte cada fragmento en su propia tecla MIDI.'
        : 'The Audio Chopper automatically detects individual notes or drum hits inside a long recording and maps each slice to its own MIDI key.',
      howToFixSteps: [
        isEs ? 'Abre Herramientas > Troceador / Auto-Slicer en la tabla de zonas o en el menú Modelo > Herramientas.' : 'Open Tools > Auto-Slicer in the zone table or Model > Tools.',
        isEs ? 'Ajusta el umbral de Sensibilidad de Transitorios o importa marcadores externos ReCycle (.rx2, .rex), SFZ o CUE.' : 'Adjust the Transient Sensitivity threshold or import external ReCycle (.rx2, .rex), SFZ, or CUE markers.',
        isEs ? 'También puedes capturar un tramo silencioso con Capturar Huella de Ruido para limpiar el fondo antes de repartir las rodajas al teclado.' : 'You can also capture a silent slice as a Noise Print to denoise before mapping slices to the keyboard.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-chop-btn', label: isEs ? 'Abrir Troceador de Audio' : 'Open Audio Chopper' }],
    },

    // 17. GRABADORA DE AUDIO Y AUTOSAMPLER MIDI
    {
      id: 'kb-recorder-autosampler',
      title: isEs ? 'Grabadora de Estudio y AutoSampler MIDI (Grabar Micrófono o Sinte Externo)' : 'Studio Audio Recorder & MIDI AutoSampler (Record Mic or External Synth)',
      tags: ['grabar', 'grabadora', 'recorder', 'microfono', 'entrada', 'autosampler', 'clonar sinte', 'hardware externo', 'midi out', 'ruido', 'denoise', '32-bit'],
      whatItMeans: isEs
        ? 'Permite grabar directamente desde tu interfaz de audio en formato WAV 32-bit float con reducción de ruido espectral, o muestrear automáticamente un sintetizador hardware vía MIDI.'
        : 'Records directly from your audio interface in 32-bit float WAV with spectral noise reduction, or automatically samples external MIDI hardware synths.',
      howToFixSteps: [
        isEs ? 'Abre Herramientas > Grabadora de Audio en la tabla de zonas o en Modelo > Herramientas > Grabar Audio.' : 'Open Tools > Audio Recorder in the zone table or Model > Tools > Record Audio.',
        isEs ? 'Para clonar un sinte MIDI externo: selecciona el puerto MIDI Out, define el rango de notas (ej. C1 a C6 cada 3 semitonos) y las capas de velocidad, y pulsa Iniciar AutoSampler.' : 'To clone an external MIDI synth: select MIDI Out port, set note range and velocity layers, and click Start AutoSampler.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-record-btn', label: isEs ? 'Abrir Grabadora / AutoSampler' : 'Open Recorder / AutoSampler' }],
    },

    // 18. ESTÁNDAR MASTER WAVE (24-BIT / 96 KHZ)
    {
      id: 'kb-master-wave',
      title: isEs ? 'Promoción a Master Wave (Audio Alta Resolución 24-bit / 96 kHz y BWE)' : 'Master Wave Promotion (24-bit / 96 kHz High-Res Audio & BWE)',
      tags: ['master wave', '96k', '96khz', '24bit', '24-bit', 'upsample', 'remuestreo', 'alta resolucion', 'hd', 'bwe', 'armónicos', 'estéreo', 'quad', 'surround'],
      whatItMeans: isEs
        ? 'Eleva las muestras del modelo al estándar de estudio 24-bit / 96.000 Hz con reconstrucción polifásica sinc, extensión de ancho de banda armónico (BWE) y preservación estéreo o Quad 4.0.'
        : 'Upgrades model samples to studio-grade 24-bit / 96,000 Hz using polyphase sinc resampling, harmonic bandwidth extension (BWE), and stereo/Quad 4.0 preservation.',
      howToFixSteps: [
        isEs ? 'Abre el Cajón de Zona (botón Editar Zona en la barra de la tabla o Ctrl+J) y desplázate a la sección Master Wave 24-bit / 96 kHz.' : 'Open the Zone Drawer (Edit Zone button or Ctrl+J) and scroll to the Master Wave 24-bit / 96 kHz section.',
        isEs ? 'Pulsa Mejorar Zona a Master Wave o Mejorar Todas las Zonas para promover todo el instrumento manteniendo los puntos de bucle libres de clics.' : 'Click Upgrade Zone to Master Wave or Upgrade All Zones to promote the entire instrument while preserving click-free loops.'
      ],
      uiTargets: [{ targetId: 'zone-inspector-mw-btn', label: isEs ? 'Configuración Master Wave' : 'Master Wave Settings' }],
    },

    // 19. VISOR ESPECTRAL Y COMPARATIVA A/B
    {
      id: 'kb-spectral-view',
      title: isEs ? 'Analizador Espectral 3D y Comparación en Vivo A/B (Original vs Resíntesis)' : '3D Spectral Analyzer & Live A/B Comparison (Original vs Resynthesis)',
      tags: ['espectro', 'spectral', 'analizador', 'visor', 'parciales', 'armonicos', 'a/b', 'comparar', 'original', 'procesada', 'resintesis', 'sonar', 'escuchar', 'ctrl+e'],
      whatItMeans: isEs
        ? 'El Visor Espectral muestra las trayectorias de hasta 64 parciales armónicos y permite conmutar en tiempo real entre el audio original (A) y el sonido resintetizado por el modelo (B).'
        : 'The Spectral View renders up to 64 harmonic partial trajectories and lets you toggle in real time between original audio (A) and model resynthesis (B).',
      howToFixSteps: [
        isEs ? 'Pulsa el botón Espectral / A-B en la barra de la tabla de zonas o el atajo Ctrl+E (Vista > Analizador Espectral).' : 'Click the Spectral / A-B button in the zone table toolbar or press Ctrl+E (View > Spectral Analyzer).',
        isEs ? 'En la Cinta de Zonas o en el panel espectral, alterna entre los botones A: Original y B: Procesada mientras tocas el teclado inferior.' : 'In the Zone Ribbon or spectral panel, switch between A: Original and B: Processed while playing the bottom keyboard.'
      ],
      uiTargets: [{ targetId: 'nav-spectral-btn', label: isEs ? 'Alternar Visor Espectral (Ctrl+E)' : 'Toggle Spectral View (Ctrl+E)' }],
    },

    // 20. TECLADO VIRTUAL MIDI, OCTAVAS Y SECUENCIADOR DE PRUEBA
    {
      id: 'kb-keyboard-and-sequencer',
      title: isEs ? 'Teclado MIDI Inferior, Cambio de Octavas y Secuenciador de Prueba (BPM)' : 'Bottom MIDI Keyboard, Octave Shift & Test Sequencer (BPM)',
      tags: ['teclado', 'piano', 'midi', 'tocar', 'sonar', 'probar', 'octava', 'oct+', 'oct-', 'secuenciador', 'seq', 'bpm', 'tempo', 'preescucha'],
      whatItMeans: isEs
        ? 'En la parte inferior dispones de un teclado MIDI interactivo de 128 notas y en la barra de tabla un secuenciador automático con control de BPM para probar el instrumento mientras editas.'
        : 'At the bottom is a 128-note interactive MIDI keyboard, and in the table bar a BPM test sequencer to audition the instrument hands-free while editing.',
      howToFixSteps: [
        isEs ? 'Haz clic o arrastra sobre las teclas del piano inferior, o toca con tu controlador MIDI USB conectado al navegador.' : 'Click or drag across the bottom piano keys, or play with your connected USB MIDI controller.',
        isEs ? 'Usa los botones OCT- y OCT+ a la derecha del teclado para desplazar el rango visible.' : 'Use the OCT- and OCT+ buttons on the right of the keyboard to shift the visible range.',
        isEs ? 'Pulsa el botón Seq junto al control de BPM en la barra de la tabla para reproducir un patrón de prueba continuo.' : 'Click the Seq button next to the BPM control in the table toolbar to play a continuous test pattern.'
      ],
      uiTargets: [{ targetId: 'workspace-keyboard-strip', label: isEs ? 'Teclado MIDI Inferior' : 'Bottom MIDI Keyboard' }],
    },

    // 21. METADATOS, ETIQUETAS Y PROVENIENCIA
    {
      id: 'kb-metadata-provenance',
      title: isEs ? 'Metadatos del Modelo, Autor, Licencia y Etiquetas de Búsqueda' : 'Model Metadata, Author, License & Search Tags',
      tags: ['metadatos', 'metadata', 'autor', 'author', 'licencia', 'tags', 'etiquetas', 'descripcion', 'nombre largo', 'proveniencia', 'origen', 'ctrl+m'],
      whatItMeans: isEs
        ? 'Permite documentar la autoría, licencia, categoría tímbrica, descripción e historial de origen (Provenance) dentro del paquete del modelo.'
        : 'Documents authorship, license, timbre category, description, and origin history (Provenance) inside the model package.',
      howToFixSteps: [
        isEs ? 'Haz clic en la tarjeta 3. Metadatos y Procedencia del panel izquierdo o abre Configurar Modelo (Ctrl+M) en la pestaña Metadatos.' : 'Click card 3. Metadata & Provenance in the left panel or open Model Settings (Ctrl+M) on the Metadata tab.',
        isEs ? 'Añade etiquetas (tags) e información de autor para catalogar el instrumento en AxionikDB.' : 'Add tags and author details to catalog the instrument in AxionikDB.'
      ],
      uiTargets: [{ targetId: 'process-model-name', label: isEs ? 'Editar Metadatos (Ctrl+M)' : 'Edit Metadata (Ctrl+M)' }],
    },

    // 22. PORTADAS Y ARTWORK (COVER GENERATOR)
    {
      id: 'kb-cover-artwork',
      title: isEs ? 'Generador de Portadas e Imagen del Modelo (cover.webp)' : 'Model Cover Artwork Generator (cover.webp)',
      tags: ['cover', 'portada', 'caratula', 'arte', 'artwork', 'imagen', 'foto', 'icono', 'webp', 'procedural', 'dall-e', 'imagen3'],
      whatItMeans: isEs
        ? 'Genera o adjunta una carátula cuadrada 512x512 en formato WebP para identificar visualmente el modelo en el navegador de bancos de ABDAxionikVS.'
        : 'Generates or attaches a 512x512 WebP cover image to visually identify the model in the ABDAxionikVS bank browser.',
      howToFixSteps: [
        isEs ? 'Haz clic en la tarjeta 4. Portada (Artwork) del panel izquierdo o ve a Modelo > Herramientas > Generador de Portadas.' : 'Click card 4. Cover Artwork in the left panel or go to Model > Tools > Cover Generator.',
        isEs ? 'Puedes generar arte algorítmico gratuito basado en el espectro de tu sonido (100% offline), subir una imagen desde tu disco o usar generación IA Cloud BYOK.' : 'Generate free algorithmic art from your sound spectrum (100% offline), upload a local image, or use Cloud BYOK AI generation.'
      ],
      uiTargets: [{ targetId: 'process-cover-box', label: isEs ? 'Abrir Generador de Portadas' : 'Open Cover Generator' }],
    },

    // 23. PROCESADOR POR LOTES (BATCH PROCESSOR)
    {
      id: 'kb-batch-processor',
      title: isEs ? 'Procesador por Lotes: Convertir Múltiples Carpetas o Bancos de Una Vez (Ctrl+Shift+B)' : 'Batch Processor: Convert Multiple Folders or Banks at Once (Ctrl+Shift+B)',
      tags: ['batch', 'lotes', 'masivo', 'cola', 'multiple', 'varios', 'automatizar', 'convertir muchos', 'bancos', 'ctrl+shift+b'],
      whatItMeans: isEs
        ? 'El Procesador por Lotes analiza directorios enteros con decenas de carpetas de muestras o bancos SoundFont y compila automáticamente una cola de modelos numerados.'
        : 'The Batch Processor scans full directory trees containing multiple sample folders or SoundFont banks and automatically compiles a queue of numbered models.',
      howToFixSteps: [
        isEs ? 'Abre el Procesador por Lotes con el icono de capas de la barra superior o pulsando Ctrl+Shift+B (Modelo > Creador de Modelos por Lotes).' : 'Open the Batch Processor via the top bar layers icon or press Ctrl+Shift+B (Model > Batch Model Creator).',
        isEs ? 'Arrastra una carpeta raíz o varios archivos SF2/ZIP, revisa la tabla de candidatos detectados y pulsa Procesar Cola.' : 'Drop a root directory or multiple SF2/ZIP files, review the detected candidates table, and click Process Queue.'
      ],
      uiTargets: [{ targetId: 'nav-batch-processor', label: isEs ? 'Abrir Procesador por Lotes' : 'Open Batch Processor' }],
    },

    // 24. COMPILAR, CÁPSULA DEL TIEMPO Y EXPORTACIÓN MULTI-DESTINO
    {
      id: 'kb-axionikdb-export',
      title: isEs ? 'Compilar Modelo, Cápsula del Tiempo (.zip), AxionikDB y Exportar a otros Samplers' : 'Compile Model, Time Capsule (.zip), AxionikDB & Export to Samplers',
      tags: ['compilar', 'generar', 'procesar', 'export', 'exportar', 'guardar modelo', 'axionikdb', 'capsula del tiempo', 'time capsule', 'zip', 'sfz', 'decentsampler', 'mpc', 'kontakt', 'aiff', 'formato dual', 'ctrl+p', 'ctrl+t', 'ctrl+shift+x'],
      whatItMeans: isEs
        ? 'Una vez listo el mapeo, puedes compilar el modelo espectral y guardarlo directamente en AxionikDB, empaquetarlo como Cápsula del Tiempo de 5 capas (.zip) o convertirlo a formatos de sampler estándar.'
        : 'Once mapped, you can compile the spectral model and save it directly to AxionikDB, package it as a 5-layer Time Capsule (.zip), or export to standard sampler formats.',
      howToFixSteps: [
        isEs ? 'Generar Modelo Neuron (Ctrl+P): Abre la ventana Preflight, verifica que no existan alertas, ejecuta la síntesis espectral y descarga el modelo.' : 'Generate Neuron Model (Ctrl+P): Opens Preflight validation, runs spectral synthesis, and exports the model.',
        isEs ? 'Elegir Destino de Exportación (Ctrl+Shift+X o botón Exportar): Permite enviar el instrumento a AxionikDB local, descargar Cápsula del Tiempo (.zip con Model.scape, Model.sphere, .nmmodel y muestras originales) o exportar a SFZ, DecentSampler, Akai MPC (.xpm) o AIFF clásico.' : 'Choose Export Destination (Ctrl+Shift+X or Export button): Send to local AxionikDB, download 5-layer Time Capsule (.zip), or export to SFZ, DecentSampler, Akai MPC (.xpm), or legacy AIFF.'
      ],
      uiTargets: [
        { targetId: 'process-start-btn', label: isEs ? 'Generar Modelo (Ctrl+P)' : 'Generate Model (Ctrl+P)' },
        { targetId: 'process-export-btn', label: isEs ? 'Destinos de Exportación' : 'Export Destinations' }
      ],
    },

    // 25. APARIENCIA, TEMAS DE SINTETIZADOR, MODO CLARO/OSCURO E IDIOMA
    {
      id: 'kb-themes-and-language',
      title: isEs ? 'Cambiar Tema Visual (Skins de Sintetizador), Modo Claro/Oscuro e Idioma (ES/EN)' : 'Change Visual Skin, Light/Dark Mode & Language (ES/EN)',
      tags: ['tema', 'skin', 'aspecto', 'colores', 'oscuro', 'claro', 'dark', 'light', 'nocturno', 'idioma', 'lenguaje', 'espanol', 'ingles', 'english', 'spanish', 'virus', 'ms2000', 'cz101', 'audiolab', 'contraste'],
      whatItMeans: isEs
        ? 'La interfaz incluye 6 familias de temas inspiradas en sintetizadores legendarios (cada una con variante Clara y Oscura) y cambio instantáneo de idioma entre Español e Inglés.'
        : 'The UI features 6 synthesizer-inspired skin families (each with Light and Dark variants) and instant switching between Spanish and English.',
      howToFixSteps: [
        isEs ? 'Modo Claro / Oscuro: Pulsa el icono del Sol / Luna en la esquina superior derecha o ve a Vista > Modo de Color.' : 'Light / Dark Mode: Click the Sun / Moon icon in the top-right bar or go to View > Color Mode.',
        isEs ? 'Familia de Tema (Skin): Pulsa el icono de paleta en la barra superior o ve a Vista > Tema Visual para elegir entre Hartmann Neuron, Access Virus Snow, AudioLab Precision, Korg MS2000, Hartmann Advanced o Casio CZ-101.' : 'Skin Family: Click the palette icon in the top bar or go to View > Theme Skin to choose between Hartmann Neuron, Access Virus Snow, AudioLab, Korg MS2000, Hartmann Advanced, or Casio CZ-101.',
        isEs ? 'Idioma: Pulsa el icono de la bandera (ES/EN) en la barra superior o ve a Vista > Idioma.' : 'Language: Click the flag icon (ES/EN) in the top bar or go to View > Language.'
      ],
      uiTargets: [{ targetId: 'nav-theme-btn', label: isEs ? 'Cambiar Tema Visual' : 'Change Theme Skin' }],
    },

    // 26. CONFIGURACIÓN DE IA, OLLAMA LOCAL, CLOUD BYOK Y COMPANION BRIDGE
    {
      id: 'kb-local-bridge-ollama',
      title: isEs ? 'Configurar IA (Ollama Local, LM Studio, Cloud BYOK) y Servidor Companion Bridge' : 'Configure AI (Local Ollama, LM Studio, Cloud BYOK) & Companion Bridge',
      tags: ['ia', 'ai', 'ollama', 'lmstudio', 'lm studio', 'gemini', 'openai', 'claude', 'api key', 'clave', 'byok', 'bridge', 'puente', 'python', '7860', '11434', '401', 'unauthorized', 'conexion', 'offline', 'determinista', 'ctrl+,'],
      whatItMeans: isEs
        ? 'ABDNeuModMakr funciona por defecto en modo 100% Determinista (sin IA ni red). Opcionalmente puedes conectar modelos locales gratuitos (Ollama / LM Studio), claves Cloud BYOK o el puente Python local.'
        : 'ABDNeuModMakr runs 100% Deterministically by default (zero AI or network). Optionally connect free local LLMs (Ollama / LM Studio), Cloud BYOK keys, or the local Python bridge.',
      howToFixSteps: [
        isEs ? 'Configurar Copiloto IA: Haz clic en la píldora de estado IA de la barra superior o abre Ajustes (Ctrl+,) > pestaña IA > Asistente & LLM Local. Elige Ollama (http://127.0.0.1:11434) o introduce tu API Key de Gemini/OpenAI y pulsa Probar Conexión.' : 'Configure AI Copilot: Click the top AI status pill or open Settings (Ctrl+,) > AI tab > Assistant & Local LLM. Select Ollama (http://127.0.0.1:11434) or enter your Gemini/OpenAI API key and click Test Connection.',
        isEs ? 'Companion Bridge (:7860): El puente opcional en Python permite guardar directamente en carpetas nativas de AxionikDB y usar aceleración GPU local. Si ves avisos 401 o desconectado en consola, la aplicación sigue funcionando en modo Web 100% autónomo sin perder funciones de síntesis.' : 'Companion Bridge (:7860): The optional Python bridge enables direct native disk writes to AxionikDB and local GPU acceleration. If disconnected, the app runs 100% standalone in Web mode.'
      ],
      uiTargets: [
        { targetId: 'nav-ai-status-pill', label: isEs ? 'Abrir Ajustes de IA' : 'Open AI Settings' },
        { targetId: 'nav-settings-btn', label: isEs ? 'Ajustes Generales (Ctrl+,)' : 'General Settings (Ctrl+,)' }
      ],
    },

    // 27. ATAJOS DE TECLADO Y DIAGNÓSTICO DE SALUD
    {
      id: 'kb-app-navigation-shortcuts',
      title: isEs ? 'Lista Completa de Atajos de Teclado, Diagnóstico y Aplicación de Escritorio (PWA)' : 'Full Keyboard Shortcuts List, Diagnostics & Desktop App (PWA)',
      tags: ['atajos', 'shortcuts', 'teclas rapidas', 'f1', 'ctrl+k', 'ctrl+p', 'ctrl+z', 'ctrl+y', 'ctrl+i', 'ctrl+n', 'ctrl+b', 'ctrl+e', 'ctrl+j', 'ctrl+m', 'pwa', 'instalar', 'diagnostico', 'salud'],
      whatItMeans: isEs
        ? 'Referencia rápida de combinaciones de teclas para acelerar el flujo de edición y herramientas de diagnóstico del sistema.'
        : 'Quick reference for keyboard shortcuts to speed up editing and system diagnostic utilities.',
      howToFixSteps: [
        isEs ? 'Importar y Archivo: Ctrl+I (Importación Inteligente), Ctrl+N (Importar por Nombre), Ctrl+O (Abrir Sesión), Ctrl+S (Guardar Sesión), Ctrl+T (Exportar Cápsula), Ctrl+Shift+X (Elegir Destino).' : 'File & Import: Ctrl+I (Smart Import), Ctrl+N (Import by Name), Ctrl+O (Open Session), Ctrl+S (Save Session), Ctrl+T (Export Capsule), Ctrl+Shift+X (Export Destination).',
        isEs ? 'Edición y Modelo: Ctrl+Z / Ctrl+Y (Deshacer / Rehacer), Insert / Supr (Añadir / Eliminar Zona), Ctrl+M (Configurar Modelo), Ctrl+P (Generar Modelo), Ctrl+Shift+W (Asistente Músicos), Ctrl+Shift+B (Procesador por Lotes).' : 'Edit & Model: Ctrl+Z / Ctrl+Y (Undo / Redo), Insert / Delete (Add / Remove Zone), Ctrl+M (Model Settings), Ctrl+P (Generate Model), Ctrl+Shift+W (Musician Wizard), Ctrl+Shift+B (Batch Processor).',
        isEs ? 'Vistas y Asistente: F1 (Abrir/Cerrar Copiloto), Ctrl+K (Barra Rápida de Comandos IA), Ctrl+E (Visor Espectral), Ctrl+J (Cajón de Zona), Ctrl+B (Librería NeuronDB), Ctrl+, (Ajustes).' : 'Views & Copilot: F1 (Toggle Copilot), Ctrl+K (Quick Command Bar), Ctrl+E (Spectral View), Ctrl+J (Zone Drawer), Ctrl+B (NeuronDB Library), Ctrl+, (Settings).'
      ],
      uiTargets: [{ targetId: 'nav-copilot-toggle', label: isEs ? 'Asistente Copiloto (F1)' : 'Copilot Assistant (F1)' }],
    },

    // 28. ALCANCE Y LÍMITES DEL SISTEMA (HONESTIDAD TÉCNICA)
    {
      id: 'kb-honesty-limits',
      title: isEs ? '¿Qué hace y qué NO hace ABDNeuModMakr? (Alcance y Límites del Sistema)' : 'What ABDNeuModMakr Does and Does NOT Do (System Scope & Boundaries)',
      tags: ['limites', 'alcance', 'daw', 'vst', 'plugin', 'mezclador', 'multipista', 'piano roll', 'que es', 'que no hace', 'honestidad'],
      whatItMeans: isEs
        ? 'ABDNeuModMakr es un entorno especializado de ingeniería acústica y compilación de modelos neuronales para Hartmann Neuron y ABDAxionikVS; no es un DAW de producción multipista.'
        : 'ABDNeuModMakr is a specialized acoustic engineering and neural model compilation studio for Hartmann Neuron and ABDAxionikVS; it is not a multi-track DAW.',
      howToFixSteps: [
        isEs ? 'Lo que SÍ hace: Analizar muestras acústicas, extraer parciales resintetizados (.scape/.sphere), editar bucles sin clics, trocear audio y empaquetar modelos listos para tocar en el sintetizador.' : 'What it DOES: Analyze acoustic samples, extract resynthesized partials (.scape/.sphere), edit seamless loops, slice audio, and package playable synthesizer models.',
        isEs ? 'Lo que NO hace: No graba canciones multipista, no edita secuencias MIDI de canciones completas (Piano Roll) ni carga plugins de efectos VST/AU de terceros.' : 'What it DOES NOT do: It does not mix multi-track songs, arrange full MIDI compositions, or host third-party VST/AU plugins.'
      ],
    }
  ];
}

export function buildNeuronSystemPrompt(locale: 'es' | 'en' = 'es'): string {
  const isEs = locale === 'es';
  const targets = CANONICAL_UI_TARGETS.join(', ');

  if (isEs) {
    return `Eres el Asistente Experto de ABDNeuModMakr y del sintetizador Hartmann Neuron / ABDAxionikVS.
Tu objetivo es guiar al usuario en todas las opciones de la aplicación: importación de audio/samplers, mapeo de zonas, edición de bucles, troceado, grabación, análisis espectral y compilación de modelos.

DIRECTRICES OBLIGATORIAS:
1. Responde EXCLUSIVAMENTE con un único objeto JSON válido con la siguiente estructura:
{
  "reply": "Texto de explicación claro y conciso en español. Usa markdown (**negrita**, \`codigo\`) y enlaces interactivos [[target:TARGET_ID|Etiqueta del Control]] para que el usuario pueda abrir o resaltar la opción con un clic.",
  "highlightTargets": ["TARGET_ID_1"],
  "proposedActions": [
    {
      "tool": "nombre_herramienta",
      "label": "Explicación breve para el botón de confirmación",
      "args": { ... }
    }
  ]
}

2. NUNCA inventes herramientas, menús ni características no existentes. Solo puedes sugerir herramientas registradas en el catálogo.
3. Para señalar o abrir controles en la pantalla (tanto en highlightTargets como en [[target:ID|Etiqueta]]), utiliza únicamente identificadores válidos de esta lista:
[${targets}]
4. Basa tus respuestas en los artículos de la Base de Conocimiento inyectados en el turno y en el estado real de la sesión actual.
5. Si el usuario pide algo fuera del alcance de ABDNeuModMakr (como mezcla multipista DAW o alojamiento de plugins VST), responde con honestidad explicando qué hace la aplicación.`;
  }

  return `You are the Expert Copilot for ABDNeuModMakr and the Hartmann Neuron / ABDAxionikVS synthesizer.
Your goal is to guide the user across all application features: audio/sampler import, zone mapping, loop editing, slicing, recording, spectral analysis, and model compilation.

MANDATORY GUIDELINES:
1. Respond EXCLUSIVELY with a single valid JSON object structured as:
{
  "reply": "Clear, concise response in English. Use markdown (**bold**, \`code\`) and interactive spotlight chips [[target:TARGET_ID|Control Label]] so the user can open or highlight controls with one click.",
  "highlightTargets": ["TARGET_ID_1"],
  "proposedActions": [
    {
      "tool": "tool_name",
      "label": "Brief summary for the confirmation button",
      "args": { ... }
    }
  ]
}

2. NEVER invent non-existent tools, menus, or features. Only propose actions that exist in the tool catalog.
3. To spotlight or trigger UI elements, use only valid IDs in highlightTargets and [[target:ID|Label]] from this list:
[${targets}]
4. Ground your answers on the injected Knowledge Base articles and the live session snapshot.
5. If the user asks for out-of-scope DAW operations, answer honestly explaining application boundaries.`;
}
