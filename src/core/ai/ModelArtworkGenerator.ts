// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Model Cover Artwork Generator (Fase 20)
//
// Multi-provider orchestrator for generating publication-quality
// 512×512 WebP album artwork for synth models:
//   1. Procedural Acoustic Spectrogram (Instant, 100% offline, zero-cost)
//   2. Google Gemini / Imagen 3 (Cloud BYOK)
//   3. OpenAI DALL-E 3 (Cloud BYOK)
//   4. Hugging Face Inference API / FLUX (Cloud BYOK)
//   5. Replicate FLUX / SDXL (Cloud BYOK)
//   6. Local Companion Bridge (Port 7860)
// ─────────────────────────────────────────────────────────

import { convertImageToCoverWebp } from '../coverArtwork.ts';
import type { ModelCoverArtwork } from '../types.ts';
import { cloudByokClient } from './CloudByokClient.ts';
import { generateProceduralArtwork } from './ProceduralAcousticArtwork.ts';
import { delay } from '../asyncUtils.ts';

export type ArtworkStylePreset =
  | 'cyberpunk'
  | 'retro_80s'
  | 'minimalist_vector'
  | 'studio_hifi'
  | 'organic_watercolor'
  | 'neural_abstract';

export type ArtworkProvider =
  | 'procedural'
  | 'gemini'
  | 'openai'
  | 'openrouter'
  | 'claude'
  | 'huggingface'
  | 'replicate'
  | 'bridge';

export interface ArtworkStyleInfo {
  id: ArtworkStylePreset;
  name: string;
  description: string;
  keywords: string;
}

export const ARTWORK_STYLES: readonly ArtworkStyleInfo[] = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Synthesizer',
    description: 'Neon holograms, cyan & magenta conduits, dark futuristic aesthetic',
    keywords:
      'cyberpunk neon synthesizer aesthetic, dark moody backdrop, glowing cyan and magenta conduits, futuristic holographic audio interface, 8k octane render, cinematic lighting',
  },
  {
    id: 'retro_80s',
    name: '1980s Analog Hardware',
    description: 'Outrun sunset grid, warm tape saturation, airbrush synthwave art',
    keywords:
      'vintage 1980s synthesizer hardware album art, retrofuturism, outrun sunset grid, warm analog tape saturation aesthetic, airbrush synth art, synthwave color palette',
  },
  {
    id: 'minimalist_vector',
    name: 'Minimalist Bauhaus Vector',
    description: 'Geometric acoustic circles, clean lines, Swiss design precision',
    keywords:
      'minimalist Bauhaus vector album art, geometric acoustic resonance circles, crisp Bauhaus lines, modern flat graphic design, Swiss typography influence, matte finish',
  },
  {
    id: 'studio_hifi',
    name: 'Studio Hi-Fi Audiophile',
    description: 'Brushed metal, acoustic sculpture, obsidian glass & golden reflections',
    keywords:
      'high-end audiophile studio acoustic sculpture, brushed titanium and obsidian glass, golden soundwave reflections, hyper-detailed macro photography, cinematic depth of field',
  },
  {
    id: 'organic_watercolor',
    name: 'Organic Acoustic Watercolor',
    description: 'Flowing soundwaves, natural earthly timbre, fluid brush strokes',
    keywords:
      'organic acoustic watercolor abstract artwork, flowing liquid soundwaves, natural earthly timbre textures, delicate brush strokes, warm harmonious palette',
  },
  {
    id: 'neural_abstract',
    name: 'Neural Latent Space',
    description: 'Multidimensional spectral manifold, synaptic glow, quantum vibes',
    keywords:
      'neural latent space visualization, morphing multidimensional spectral manifold, synaptic connections, deep space iridescent glow, quantum computing aesthetics',
  },
];

export interface ArtworkGenerationRequest {
  modelName: string;
  expandedName?: string;
  parameterSet?: number;
  parameterSetName?: string;
  category?: string;
  sampleNames?: string[];
  style: ArtworkStylePreset;
  customPrompt?: string;
  provider: ArtworkProvider;
  detectedF0Hz?: number;
  apiKey?: string;
}

export interface DetectedAcousticMotif {
  instrument: string;
  category: string;
  visualCue: string;
}

/**
 * Intelligent acoustic & instrument motif extractor.
 * Scans model names, expanded descriptions, category tags, and sample filenames
 * (e.g. "Violin_Strad_C4.wav", "Steinway_Grand_Piano.aif", "TB303_Acid_Saw.wav")
 * and extracts the semantic instrument identity and an evocative visual cue.
 */
export function extractAcousticInstrumentMotif(
  sources: (string | undefined | null)[]
): DetectedAcousticMotif | null {
  const combined = sources
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/[_\-\.]+/g, ' ');

  if (!combined.trim()) return null;

  // Ordered match rules: more specific matches first
  const rules: Array<{
    patterns: RegExp[];
    instrument: string;
    category: string;
    visualCue: string;
  }> = [
    // Bowed Strings
    {
      patterns: [/\bviol[ií]n\b/i, /\bfiddle\b/i, /\bstradivarius\b/i, /\bguarneri\b/i],
      instrument: 'Violin',
      category: 'Bowed Strings',
      visualCue:
        'harmoniously featuring an artistic stylized silhouette and elegant acoustic wooden curves of a violin integrated into the composition',
    },
    {
      patterns: [/\bviola\b/i],
      instrument: 'Viola',
      category: 'Bowed Strings',
      visualCue:
        'harmoniously featuring the warm acoustic silhouette and wooden f-hole contours of a viola integrated into the composition',
    },
    {
      patterns: [/\bcello\b/i, /\bvioloncello\b/i],
      instrument: 'Cello',
      category: 'Bowed Strings',
      visualCue:
        'harmoniously featuring the graceful, resonant wooden silhouette of a cello integrated into the composition',
    },
    {
      patterns: [/\bcontrabass\b/i, /\bdouble\s*bass\b/i, /\bupright\s*bass\b/i, /\bcontrabajo\b/i],
      instrument: 'Upright Double Bass',
      category: 'Bowed Strings',
      visualCue:
        'harmoniously featuring the deep, majestic silhouette of an acoustic upright double bass integrated into the composition',
    },
    {
      patterns: [/\bstrings\b/i, /\borchestral\s*strings\b/i, /\bcuerdas\b/i, /\bpizzicato\b/i],
      instrument: 'Orchestral Strings',
      category: 'Bowed Strings',
      visualCue:
        'harmoniously featuring flowing orchestral string body curves and resonant wooden instrument contours',
    },

    // Pianos & Keyboards
    {
      patterns: [/\bgrand\s*piano\b/i, /\bpiano\s*de\s*cola\b/i, /\bsteinway\b/i, /\bbosendorfer\b/i, /\bconcert\s*grand\b/i],
      instrument: 'Concert Grand Piano',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the sweeping concert grand piano lid silhouette and ivory acoustic key geometry',
    },
    {
      patterns: [/\bupright\s*piano\b/i, /\bpiano\s*vertical\b/i, /\bacoustic\s*piano\b/i, /\bpiano\b/i],
      instrument: 'Acoustic Piano',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the warm acoustic upright piano cabinet and felt hammer geometry',
    },
    {
      patterns: [/\brhodes\b/i, /\bfender\s*rhodes\b/i, /\belectric\s*piano\b/i, /\bepiano\b/i, /\be-piano\b/i],
      instrument: 'Rhodes Electric Piano',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the iconic electric piano silhouette, vintage tine resonance bars and warm 70s keyboard styling',
    },
    {
      patterns: [/\bwurlitzer\b/i, /\bwurly\b/i],
      instrument: 'Wurlitzer Electric Piano',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the classic Wurlitzer reed piano silhouette and vintage analog vibrato aesthetic',
    },
    {
      patterns: [/\bclavinet\b/i, /\bclav\b/i],
      instrument: 'Clavinet',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the funk clavinet keyboard profile and rocker switch geometry',
    },
    {
      patterns: [/\bhammond\b/i, /\btonewheel\b/i, /\bb3\b/i, /\bleslie\b/i],
      instrument: 'Hammond Organ',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the dual-manual organ drawbar console and revolving Leslie horn aesthetic',
    },
    {
      patterns: [/\bpipe\s*organ\b/i, /\bchurch\s*organ\b/i, /\b[oó]rgano\b/i],
      instrument: 'Cathedral Pipe Organ',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring majestic cathedral organ pipes and polished acoustic flutes',
    },
    {
      patterns: [/\baccordion\b/i, /\bacorde[oó]n\b/i],
      instrument: 'Accordion',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring folding acoustic accordion bellows and pearloid treble grill contours',
    },
    {
      patterns: [/\bharpsichord\b/i, /\bclavecin\b/i, /\bclavicordio\b/i],
      instrument: 'Harpsichord',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring delicate baroque harpsichord plucking jacks and ornate acoustic soundboard inlay',
    },
    {
      patterns: [/\bcelesta\b/i],
      instrument: 'Celesta',
      category: 'Keyboard',
      visualCue:
        'harmoniously featuring the delicate bell-piano silhouette and steel tone plate mechanism',
    },

    // Plucked Strings & Guitars
    {
      patterns: [/\bharp\b/i, /\barpa\b/i],
      instrument: 'Concert Harp',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the sweeping golden pillar, pedal box and ascending string array of a concert pedal harp',
    },
    {
      patterns: [/\bsitar\b/i],
      instrument: 'Sitar',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the resonant gourd silhouette, curved frets and sympathetic strings of an acoustic sitar',
    },
    {
      patterns: [/\bkoto\b/i, /\bshamisen\b/i],
      instrument: 'Koto',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the elongated paulownia wood soundboard and movable bridge array of a Japanese koto',
    },
    {
      patterns: [/\bbanjo\b/i],
      instrument: 'Banjo',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the circular parchment head, wooden rim and five-string tailpiece of an acoustic banjo',
    },
    {
      patterns: [/\bmandolin\b/i, /\bmandolina\b/i],
      instrument: 'Mandolin',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the arched teardrop scroll, f-holes and dual brass strings of an acoustic mandolin',
    },
    {
      patterns: [/\bukulele\b/i, /\bukelele\b/i],
      instrument: 'Ukulele',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the compact wooden acoustic ukulele body and nylon string silhouette',
    },
    {
      patterns: [/\bacoustic\s*guitar\b/i, /\bnylon\s*guitar\b/i, /\bclassical\s*guitar\b/i, /\bguitarra\s*ac[uú]stica\b/i],
      instrument: 'Acoustic Guitar',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the warm curves of a wooden acoustic guitar body, rosette soundhole and fretboard geometry',
    },
    {
      patterns: [/\belectric\s*guitar\b/i, /\bstratocaster\b/i, /\btelecaster\b/i, /\bles\s*paul\b/i, /\bguitar\b/i, /\bguitarra\b/i],
      instrument: 'Electric Guitar',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the iconic sculpted contours of an electric guitar body and magnetic pickup pole pieces',
    },
    {
      patterns: [/\belectric\s*bass\b/i, /\bbass\s*guitar\b/i, /\bjazz\s*bass\b/i, /\bprecision\s*bass\b/i],
      instrument: 'Bass Guitar',
      category: 'Plucked Strings',
      visualCue:
        'harmoniously featuring the solid-body electric bass outline and heavy nickel-wound string contours',
    },

    // Woodwinds
    {
      patterns: [/\bflute\b/i, /\bpiccolo\b/i, /\bflauta\b/i],
      instrument: 'Flute',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the sleek silver acoustic flute silhouette and circular embouchure key mechanism',
    },
    {
      patterns: [/\bclarinet\b/i, /\bclarinete\b/i],
      instrument: 'Clarinet',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the black African blackwood clarinet body, silver key ring cluster and flared bell',
    },
    {
      patterns: [/\boboe\b/i],
      instrument: 'Oboe',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the slender conical oboe body, double reed cane contour and silver keywork',
    },
    {
      patterns: [/\bbassoon\b/i, /\bfagot\b/i],
      instrument: 'Bassoon',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the curved maple wood bassoon wing joint, bocal crook and dual reed mechanism',
    },
    {
      patterns: [/\bsaxophone\b/i, /\bsax\b/i, /\bsaxo\b/i],
      instrument: 'Saxophone',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the gleaming brass curves, pearloid key buttons and flared bell of an acoustic saxophone',
    },
    {
      patterns: [/\bduduk\b/i],
      instrument: 'Duduk',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the ancient Armenian apricot wood duduk body and broad cane reed silhouette',
    },
    {
      patterns: [/\bshakuhachi\b/i],
      instrument: 'Shakuhachi',
      category: 'Woodwinds',
      visualCue:
        'harmoniously featuring the root-end bamboo shakuhachi flute silhouette and angled blowing edge',
    },

    // Brass
    {
      patterns: [/\btrumpet\b/i, /\btrompeta\b/i, /\bcornet\b/i, /\bflugelhorn\b/i],
      instrument: 'Trumpet',
      category: 'Brass',
      visualCue:
        'harmoniously featuring the brilliant brass trumpet bell, piston valve casing and spiral tubing silhouette',
    },
    {
      patterns: [/\bfrench\s*horn\b/i, /\bcorno\b/i, /\btrompa\b/i],
      instrument: 'French Horn',
      category: 'Brass',
      visualCue:
        'harmoniously featuring the majestic circular brass french horn tubing loop and wide acoustic bell flair',
    },
    {
      patterns: [/\btrombone\b/i, /\btromb[oó]n\b/i],
      instrument: 'Trombone',
      category: 'Brass',
      visualCue:
        'harmoniously featuring the cylindrical brass slide, counterweight and resonant trombone bell silhouette',
    },
    {
      patterns: [/\btuba\b/i, /\bsousaphone\b/i],
      instrument: 'Tuba',
      category: 'Brass',
      visualCue:
        'harmoniously featuring the massive low-brass tuba bell and gleaming acoustic brass coil silhouette',
    },
    {
      patterns: [/\bbrass\b/i, /\bmetales\b/i, /\bhorn\s*section\b/i],
      instrument: 'Brass Section',
      category: 'Brass',
      visualCue:
        'harmoniously featuring gleaming horn flares and sculptural acoustic brass contours',
    },

    // Mallets & Percussion
    {
      patterns: [/\bmarimba\b/i],
      instrument: 'Marimba',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring stepped wooden acoustic rosewood tone bars and descending acoustic resonators',
    },
    {
      patterns: [/\bvibraphone\b/i, /\bvibes\b/i],
      instrument: 'Vibraphone',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring polished metallic vibraphone bars and spinning damper flutter discs',
    },
    {
      patterns: [/\bxylophone\b/i, /\bxil[oó]fono\b/i],
      instrument: 'Xylophone',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring bright acoustic wooden mallet bars and struck tone geometry',
    },
    {
      patterns: [/\bglockenspiel\b/i, /\bchimes\b/i, /\bcarillon\b/i],
      instrument: 'Glockenspiel',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring bright tuned steel bells and crystalline mallet percussion geometry',
    },
    {
      patterns: [/\bkalimba\b/i, /\bmbira\b/i, /\bthumb\s*piano\b/i],
      instrument: 'Kalimba',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring mounted steel spring tines and hardwood soundboard cavity of an acoustic kalimba',
    },
    {
      patterns: [/\btimpani\b/i, /\bkettledrum\b/i],
      instrument: 'Timpani',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring gleaming copper hemispherical timpani bowls and tension tuning rods',
    },
    {
      patterns: [/\b808\b/i, /\bsub\s*bass\b/i],
      instrument: '808 Sub Bass',
      category: 'Electronic Percussion',
      visualCue:
        'harmoniously featuring low-frequency acoustic sine pressure waves and analog drum machine waveform iconography',
    },
    {
      patterns: [/\bsnare\b/i, /\bredoblante\b/i],
      instrument: 'Snare Drum',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring circular acoustic drum tension hoops, wooden snare shell and metallic rim silhouette',
    },
    {
      patterns: [/\bkick\s*drum\b/i, /\bbombo\b/i],
      instrument: 'Kick Drum',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring massive low-end circular acoustic drum head geometry and beater impact waves',
    },
    {
      patterns: [/\bconga\b/i, /\bbongo\b/i, /\bdjembe\b/i],
      instrument: 'Hand Percussion',
      category: 'Percussion',
      visualCue:
        'harmoniously featuring the hand-carved hardwood shell and stretched rawhide skin of acoustic percussion',
    },

    // Synthesizers & Electronic Hardware
    {
      patterns: [/\bmoog\b/i, /\bminimoog\b/i],
      instrument: 'Moog Synthesizer',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring the iconic angled wooden synthesis panel, ladder filter knobs and heavy rotary switch silhouette',
    },
    {
      patterns: [/\btb-?303\b/i, /\bacid\b/i],
      instrument: 'TB-303 Bassline',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring the silver acid bassline box silhouette, stepped pattern matrix and resonance knob styling',
    },
    {
      patterns: [/\bjupiter\b/i, /\bjuno\b/i],
      instrument: 'Analog Poly Synth',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring the vintage analog synth slider array, bender lever and rainbow chassis graphics',
    },
    {
      patterns: [/\bprophet\b/i, /\bsequential\b/i],
      instrument: 'Sequential Prophet',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring walnut synth side cheeks, matrix LED buttons and analog potentiometer knobs',
    },
    {
      patterns: [/\bmodular\b/i, /\beurorack\b/i],
      instrument: 'Modular Synthesizer',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring modular patch cables, knurled 3.5mm jacks and precision CV attenuator dials',
    },
    {
      patterns: [/\bfm\s*synth\b/i, /\bdx7\b/i, /\boperator\b/i],
      instrument: 'FM Synthesizer',
      category: 'Synthesizer',
      visualCue:
        'harmoniously featuring algorithmic operator algorithms, crisp LCD grid matrices and complex wavetable topological surfaces',
    },

    // Vocal & Choral
    {
      patterns: [/\bchoir\b/i, /\bchoral\b/i, /\bvocal\b/i, /\bsoprano\b/i, /\btenor\b/i, /\bcoro\b/i, /\bvoice\b/i, /\bvox\b/i],
      instrument: 'Vocal Choir',
      category: 'Voice',
      visualCue:
        'harmoniously featuring expressive ethereal human vocal formants, acoustic singing profile and glowing choral resonance waves',
    },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pat) => pat.test(combined))) {
      return {
        instrument: rule.instrument,
        category: rule.category,
        visualCue: rule.visualCue,
      };
    }
  }

  return null;
}

export interface ArtworkGenerationResult {
  success: boolean;
  coverArtwork?: ModelCoverArtwork;
  promptUsed: string;
  providerUsed: ArtworkProvider;
  error?: string;
  generationTimeMs: number;
}

/**
 * Automatically crafts a rich, evocative acoustic prompt from model identity and timbre.
 * Seamlessly incorporates acoustic instrument visual motifs detected from model name or sample files.
 */
export function buildAcousticArtworkPrompt(params: {
  modelName: string;
  expandedName?: string;
  parameterSet?: number;
  parameterSetName?: string;
  category?: string;
  sampleNames?: string[];
  style: ArtworkStylePreset;
  customPrompt?: string;
}): string {
  const styleInfo = ARTWORK_STYLES.find((s) => s.id === params.style) || ARTWORK_STYLES[0];
  const title = params.expandedName?.trim() || params.modelName || 'Neural Sound Model';
  const paramSetName = params.parameterSetName || `Parameter Set #${params.parameterSet ?? 0}`;
  const categoryStr = params.category ? `for ${params.category}` : '';

  let prompt = `Square album cover art for an electronic music synthesizer instrument named "${title}" ${categoryStr}. `;
  prompt += `Acoustic timbre identity: ${paramSetName}. `;
  prompt += `${styleInfo.keywords}. `;

  // Extract semantic acoustic / instrument motif from title, category and sample filenames
  const sampleText = (params.sampleNames || []).join(' ');
  const motif = extractAcousticInstrumentMotif([
    params.expandedName,
    params.modelName,
    params.category,
    sampleText,
  ]);
  if (motif) {
    prompt += `${motif.visualCue}. `;
  }

  if (params.customPrompt?.trim()) {
    prompt += `${params.customPrompt.trim()}. `;
  }

  prompt += `Square composition 1:1 aspect ratio, centered framing, high resolution, award-winning sound album design, no watermark, no text distortion.`;
  return prompt.trim();
}

/**
 * Main coordinator: dispatches the generation request to the chosen provider,
 * converts the result to 512×512 WebP and packages the `ModelCoverArtwork`.
 */
export async function generateModelArtwork(
  request: ArtworkGenerationRequest
): Promise<ArtworkGenerationResult> {
  const startTime = Date.now();
  const prompt = buildAcousticArtworkPrompt(request);

  try {
    let coverArtwork: ModelCoverArtwork;

    if (request.provider === 'procedural') {
      coverArtwork = await generateProceduralArtwork({
        modelName: request.modelName,
        expandedName: request.expandedName,
        parameterSet: request.parameterSet,
        parameterSetName: request.parameterSetName,
        category: request.category,
        style: request.style,
        detectedF0Hz: request.detectedF0Hz,
        width: 512,
        height: 512,
      });
    } else if (request.provider === 'gemini') {
      coverArtwork = await generateWithGeminiImagen(prompt, request.apiKey);
    } else if (request.provider === 'openai') {
      coverArtwork = await generateWithOpenAiDallE(prompt, request.apiKey);
    } else if (request.provider === 'openrouter') {
      coverArtwork = await generateWithOpenRouter(prompt, request.apiKey);
    } else if (request.provider === 'claude') {
      coverArtwork = await generateWithClaude(request);
    } else if (request.provider === 'huggingface') {
      coverArtwork = await generateWithHuggingFace(prompt, request.apiKey);
    } else if (request.provider === 'replicate') {
      coverArtwork = await generateWithReplicate(prompt, request.apiKey);
    } else if (request.provider === 'bridge') {
      coverArtwork = await generateWithCompanionBridge(request, prompt);
    } else {
      throw new Error(`Unsupported artwork provider: "${request.provider}"`);
    }

    return {
      success: true,
      coverArtwork,
      promptUsed: prompt,
      providerUsed: request.provider,
      generationTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      promptUsed: prompt,
      providerUsed: request.provider,
      error: err instanceof Error ? err.message : String(err),
      generationTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Google Gemini (Imagen 3 on Google AI Studio).
 */
async function generateWithGeminiImagen(
  prompt: string,
  providedKey?: string
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const key = providedKey?.trim() || byok.geminiApiKey?.trim();
  if (!key) {
    throw new Error('Google Gemini API Key is missing. Please configure it in Settings (BYOK).');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(key)}`;
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      outputMimeType: 'image/jpeg',
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Google Imagen 3 API Error (HTTP ${res.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string }>;
  };
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error('Google Imagen 3 did not return any image data in the response.');
  }

  const dataUrl = `data:image/jpeg;base64,${b64}`;
  const converted = await convertImageToCoverWebp(dataUrl, {
    targetSize: 512,
    originalName: 'gemini_imagen3_cover.webp',
  });
  return converted.artwork;
}

/**
 * OpenAI DALL-E 3.
 */
async function generateWithOpenAiDallE(
  prompt: string,
  providedKey?: string
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const key = providedKey?.trim() || byok.openaiApiKey?.trim();
  if (!key) {
    throw new Error('OpenAI API Key is missing. Please configure it in Settings (BYOK).');
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`OpenAI DALL-E 3 Error (HTTP ${res.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI DALL-E 3 did not return image data.');
  }

  const dataUrl = `data:image/png;base64,${b64}`;
  const converted = await convertImageToCoverWebp(dataUrl, {
    targetSize: 512,
    originalName: 'openai_dalle3_cover.webp',
  });
  return converted.artwork;
}

/**
 * OpenRouter (FLUX.1 / Multi-Provider Image Generation).
 */
async function generateWithOpenRouter(
  prompt: string,
  providedKey?: string
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const key = providedKey?.trim() || byok.openrouterApiKey?.trim();
  if (!key) {
    throw new Error('OpenRouter API Key is missing. Please configure it in Settings (BYOK).');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://abd-neumodmakr.vercel.app',
      'X-Title': 'ABDNeuModMakr Synthesizer Studio',
    },
    body: JSON.stringify({
      model: 'black-forest-labs/flux-1-schnell',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`OpenRouter API Error (HTTP ${res.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; images?: string[] } }>;
  };

  const choice = data.choices?.[0]?.message;
  let rawImg = choice?.images?.[0] || choice?.content;
  if (!rawImg) {
    throw new Error('OpenRouter did not return image data.');
  }
  if (!rawImg.startsWith('data:') && !rawImg.startsWith('http')) {
    rawImg = `data:image/webp;base64,${rawImg}`;
  }

  const converted = await convertImageToCoverWebp(rawImg, {
    targetSize: 512,
    originalName: 'openrouter_flux_cover.webp',
  });
  return converted.artwork;
}

/**
 * Uses a configured BYOK language model (Claude, OpenRouter, ChatGPT, Gemini, Groq, etc.)
 * to enrich and expand an acoustic artwork prompt with vivid sensory timbre metaphors.
 */
export async function enhancePromptWithByokLlm(
  basePrompt: string,
  modelName: string,
  category: string,
  parameterSetName: string
): Promise<string> {
  const provider = cloudByokClient.getFirstAvailableTextProvider();
  if (!provider) return basePrompt;

  const systemPrompt =
    'You are a visual artist and synthesizer sound curator. Enrich the input sound prompt into a vivid, single-paragraph image generation prompt for an album cover. Focus on lighting, physical materials, acoustic waves, and futuristic aesthetic. Do not output markdown, preambles or greetings, only the prompt.';

  const prompt = `Synthesizer patch: "${modelName}" (${category}), set: "${parameterSetName}". Base concept: "${basePrompt}". Expand into a rich visual prompt:`;

  try {
    const res = await cloudByokClient.generateText(prompt, {
      provider,
      maxTokens: 120,
      temperature: 0.7,
      systemPrompt,
    });
    return res.text ? `${basePrompt}, ${res.text}` : basePrompt;
  } catch {
    return basePrompt;
  }
}

/**
 * Anthropic Claude (Acoustic Prompt Reasoning & Synthesis).
 */
async function generateWithClaude(
  request: ArtworkGenerationRequest
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const key = request.apiKey?.trim() || byok.claudeApiKey?.trim();
  if (!key) {
    throw new Error('Anthropic Claude API Key is missing. Please configure it in Settings (BYOK).');
  }

  // Claude synthesizes acoustic reasoning to drive the visual direction
  let visualDirection: string | null = null;
  try {
    const response = await cloudByokClient.generateText(
      `Synthesizer patch: "${request.modelName}" (${request.category}). Aesthetic style: "${request.style}". Generate an ultra-vivid 2-sentence description of an album cover visualizing its sonic resonance and harmonics.`,
      {
        provider: 'claude',
        maxTokens: 100,
        temperature: 0.6,
        systemPrompt: 'You are an acoustic album cover designer. Keep it under 2 sentences, focused on texture and light.',
      }
    );
    visualDirection = response.text;
  } catch {
    // Non-fatal: procedural rendering proceeds
  }

  return await generateProceduralArtwork({
    modelName: request.modelName,
    expandedName: request.expandedName,
    parameterSet: request.parameterSet,
    parameterSetName: request.parameterSetName,
    category: request.category,
    style: request.style,
    customPrompt: visualDirection || request.customPrompt,
    detectedF0Hz: request.detectedF0Hz,
    width: 512,
    height: 512,
  });
}

/**
 * Hugging Face Inference API (FLUX.1-schnell).
 */
async function generateWithHuggingFace(
  prompt: string,
  providedKey?: string
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const token = providedKey?.trim() || byok.huggingfaceToken?.trim();
  if (!token) {
    throw new Error('Hugging Face User Token is missing. Please configure it in Settings (BYOK).');
  }

  const endpoint = 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Hugging Face API Error (HTTP ${res.status}): ${errorText.slice(0, 300)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  const converted = await convertImageToCoverWebp(bytes, {
    targetSize: 512,
    originalName: 'hf_flux_cover.webp',
  });
  return converted.artwork;
}

/**
 * Replicate (FLUX.1-schnell).
 */
async function generateWithReplicate(
  prompt: string,
  providedKey?: string
): Promise<ModelCoverArtwork> {
  const byok = cloudByokClient.getConfig();
  const token = providedKey?.trim() || byok.replicateToken?.trim();
  if (!token) {
    throw new Error('Replicate API Token is missing. Please configure it in Settings (BYOK).');
  }

  // Create prediction via CORS-safe Replicate client
  const createRes = await cloudByokClient.fetchReplicate(
    '/v1/models/black-forest-labs/flux-schnell/predictions',
    token,
    {
      method: 'POST',
      body: {
        input: {
          prompt,
          aspect_ratio: '1:1',
          output_format: 'webp',
        },
      },
    }
  );

  if (!createRes.ok) {
    const errorText = await createRes.text().catch(() => '');
    throw new Error(`Replicate API Error (HTTP ${createRes.status}): ${errorText.slice(0, 300)}`);
  }

  let prediction = (await createRes.json()) as {
    id: string;
    status: string;
    output?: string | string[];
    error?: string;
    urls?: { get?: string };
  };

  const getUrl = prediction.urls?.get || `/v1/predictions/${prediction.id}`;

  // Poll prediction (max 45 seconds)
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    if (prediction.status === 'succeeded' && prediction.output) break;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate generation failed: ${prediction.error || 'Unknown error'}`);
    }

    await delay(3000);

    const pollRes = await cloudByokClient.fetchReplicate(getUrl, token, {
      method: 'GET',
    });
    if (!pollRes.ok) break;
    prediction = (await pollRes.json()) as typeof prediction;
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) {
    throw new Error('Replicate generation timed out or returned no output URL.');
  }

  const imgRes = await fetch(outputUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download output image from Replicate: HTTP ${imgRes.status}`);
  }

  const imgBuf = await imgRes.arrayBuffer();
  const converted = await convertImageToCoverWebp(new Uint8Array(imgBuf), {
    targetSize: 512,
    originalName: 'replicate_flux_cover.webp',
  });
  return converted.artwork;
}

/**
 * Local Companion Bridge (Port 7860).
 */
async function generateWithCompanionBridge(
  request: ArtworkGenerationRequest,
  prompt: string
): Promise<ModelCoverArtwork> {
  const bridgeUrl = 'http://127.0.0.1:7860/api/generate-artwork';

  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      style: request.style,
      model_name: request.modelName,
      parameter_set: request.parameterSet ?? 0,
    }),
  });

  if (!res.ok) {
    throw new Error(`Companion Bridge returned HTTP ${res.status}. Check if bridge/server.py is running.`);
  }

  const data = (await res.json()) as {
    success: boolean;
    image_base64?: string;
    format?: string;
    error?: string;
  };

  if (!data.success || !data.image_base64) {
    throw new Error(data.error || 'Companion Bridge did not return artwork image data.');
  }

  const mime = data.format === 'webp' ? 'image/webp' : 'image/png';
  const dataUrl = `data:${mime};base64,${data.image_base64}`;
  const converted = await convertImageToCoverWebp(dataUrl, {
    targetSize: 512,
    originalName: 'bridge_companion_cover.webp',
  });
  return converted.artwork;
}
