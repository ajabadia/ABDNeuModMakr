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
  style: ArtworkStylePreset;
  customPrompt?: string;
  provider: ArtworkProvider;
  detectedF0Hz?: number;
  apiKey?: string;
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
 */
export function buildAcousticArtworkPrompt(params: {
  modelName: string;
  expandedName?: string;
  parameterSet?: number;
  parameterSetName?: string;
  category?: string;
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

  // Claude synthesizes deterministic acoustic geometry rendered to 512x512 WebP
  return await generateProceduralArtwork({
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

  // Create prediction
  const createRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: '1:1',
        output_format: 'webp',
      },
    }),
  });

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

  const getUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;

  // Poll prediction (max 45 seconds)
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    if (prediction.status === 'succeeded' && prediction.output) break;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate generation failed: ${prediction.error || 'Unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const pollRes = await fetch(getUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
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
