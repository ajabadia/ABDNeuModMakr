// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Procedural Acoustic Artwork Generator (Fase 20)
//
// Generates stunning, high-definition 512×512 procedural album artwork
// tailored to the acoustic timbre, Parameter Set (0..9), F0 pitch,
// and chosen aesthetic style.
//
// Zero external dependencies, runs offline with zero server costs,
// and supports both in-browser Canvas and headless testing environments.
// ─────────────────────────────────────────────────────────

import { convertImageToCoverWebp, createHeadlessWebpBytes } from '../coverArtwork.ts';
import type { ModelCoverArtwork } from '../types.ts';
import type { ArtworkStylePreset } from './ModelArtworkGenerator.ts';

export interface ProceduralArtworkOptions {
  modelName: string;
  expandedName?: string;
  parameterSet?: number;
  parameterSetName?: string;
  category?: string;
  style: ArtworkStylePreset;
  customPrompt?: string;
  detectedF0Hz?: number;
  width?: number;
  height?: number;
}

interface Palette {
  bgStart: string;
  bgEnd: string;
  accent1: string;
  accent2: string;
  accent3: string;
  glow: string;
  text: string;
}

const STYLE_PALETTES: Record<ArtworkStylePreset, Palette> = {
  cyberpunk: {
    bgStart: '#080816',
    bgEnd: '#0d1f36',
    accent1: '#00f0ff',
    accent2: '#ff007f',
    accent3: '#7928ca',
    glow: 'rgba(0, 240, 255, 0.45)',
    text: '#00f0ff',
  },
  retro_80s: {
    bgStart: '#18042a',
    bgEnd: '#3b0933',
    accent1: '#ffd700',
    accent2: '#ff007f',
    accent3: '#ff5500',
    glow: 'rgba(255, 0, 127, 0.5)',
    text: '#ffd700',
  },
  minimalist_vector: {
    bgStart: '#11141a',
    bgEnd: '#1e2533',
    accent1: '#e63946',
    accent2: '#457b9d',
    accent3: '#a8dadc',
    glow: 'rgba(230, 57, 70, 0.35)',
    text: '#f1faee',
  },
  studio_hifi: {
    bgStart: '#0c0f14',
    bgEnd: '#1c222e',
    accent1: '#d4af37',
    accent2: '#e5e5e5',
    accent3: '#8c9ba5',
    glow: 'rgba(212, 175, 55, 0.4)',
    text: '#d4af37',
  },
  organic_watercolor: {
    bgStart: '#0e1724',
    bgEnd: '#1b2d48',
    accent1: '#52b788',
    accent2: '#e07a5f',
    accent3: '#81b29a',
    glow: 'rgba(82, 183, 136, 0.35)',
    text: '#f4f1de',
  },
  neural_abstract: {
    bgStart: '#080212',
    bgEnd: '#061c28',
    accent1: '#9d4edd',
    accent2: '#00f5d4',
    accent3: '#3a86ff',
    glow: 'rgba(157, 78, 221, 0.45)',
    text: '#00f5d4',
  },
};

/**
 * Procedurally draws and encodes a 512×512 WebP artwork directly in Canvas.
 */
export async function generateProceduralArtwork(
  options: ProceduralArtworkOptions
): Promise<ModelCoverArtwork> {
  const size = options.width ?? 512;
  const pSet = Math.max(0, Math.min(9, options.parameterSet ?? 0));
  const style = options.style;
  const palette = STYLE_PALETTES[style] ?? STYLE_PALETTES.cyberpunk;
  const title = options.expandedName?.trim() || options.modelName || 'Neural Model';
  const f0 = options.detectedF0Hz && options.detectedF0Hz > 20 ? options.detectedF0Hz : 261.63; // Middle C

  // Check if browser DOM Canvas is available
  if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      renderCanvasProceduralArtwork(ctx, size, pSet, f0, palette, title, options);
      const dataUrl = canvas.toDataURL('image/webp', 0.9);
      const converted = await convertImageToCoverWebp(dataUrl, {
        targetSize: size,
        originalName: `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_cover.webp`,
      });
      return converted.artwork;
    }
  }

  // Headless fallback for Node / unit tests
  const seed = new Uint8Array(32);
  const titleBytes = new TextEncoder().encode(title);
  for (let i = 0; i < 32; i++) {
    seed[i] = ((titleBytes[i % titleBytes.length] ?? 0) * (pSet + 1) * 37 + i * 13) & 0xff;
  }
  const headlessWebp = createHeadlessWebpBytes(size, size, seed);
  const converted = await convertImageToCoverWebp(headlessWebp, {
    targetSize: size,
    originalName: `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_procedural.webp`,
  });
  return converted.artwork;
}

function renderCanvasProceduralArtwork(
  ctx: CanvasRenderingContext2D,
  size: number,
  pSet: number,
  f0: number,
  pal: Palette,
  title: string,
  options: ProceduralArtworkOptions
): void {
  const cx = size * 0.5;
  const cy = size * 0.5;

  // 1. Background radial gradient
  const bgGrad = ctx.createRadialGradient(cx, cy * 0.9, size * 0.05, cx, cy, size * 0.75);
  bgGrad.addColorStop(0, pal.bgEnd);
  bgGrad.addColorStop(1, pal.bgStart);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // 2. Subtle background acoustic grid
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  const gridStep = size / 16;
  for (let x = gridStep; x < size; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = gridStep; y < size; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Resonant concentric harmonic circles (modulated by F0)
  ctx.save();
  const ringCount = 5 + (pSet % 5);
  const baseRadius = size * 0.12;
  const f0Factor = Math.sin(f0 / 100);

  for (let i = 1; i <= ringCount; i++) {
    const r = baseRadius + (i * size * 0.32) / ringCount + f0Factor * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? pal.accent1 : pal.accent2;
    ctx.lineWidth = i === 1 ? 2.5 : 1.2;
    ctx.globalAlpha = 0.25 + (i / ringCount) * 0.25;
    ctx.stroke();
  }
  ctx.restore();

  // 4. Acoustic Timbre Motif based on Parameter Set (0..9)
  ctx.save();
  ctx.translate(cx, cy);

  if (pSet === 0) {
    // Synth / Neutral: Sharp geometric crystal polygon
    drawCrystallinePolygon(ctx, size * 0.22, 6, pal);
  } else if (pSet === 1) {
    // Strings: Multiple flowing bowed resonant ribbons
    drawResonantRibbons(ctx, size * 0.24, pal);
  } else if (pSet === 2) {
    // Keyboards: Concentric harmonic radial bars
    drawRadialHarmonicBars(ctx, size * 0.22, 24, pal);
  } else if (pSet === 3) {
    // Plucked: Logarithmic spiral wave
    drawLogarithmicSpiral(ctx, size * 0.24, pal);
  } else if (pSet === 4) {
    // Bass: Heavy subwoofer concentric shockwaves
    drawBassShockwaves(ctx, size * 0.26, pal);
  } else if (pSet === 5) {
    // Voice: Fluid vocal formant ellipses
    drawFormantEllipses(ctx, size * 0.24, pal);
  } else if (pSet === 6) {
    // Pads: Diffuse radiant nebula aurora
    drawNebulaCurtain(ctx, size * 0.26, pal);
  } else if (pSet === 7) {
    // Mallets: Starburst chime burst
    drawChimeStarburst(ctx, size * 0.22, 12, pal);
  } else if (pSet === 8) {
    // Drums: Radial transient beat wheel
    drawTransientBeatWheel(ctx, size * 0.24, 16, pal);
  } else {
    // SFX / Experimental: Chaotic Lissajous knot
    drawLissajousAcousticFigure(ctx, size * 0.24, pal);
  }
  ctx.restore();

  // 5. Dynamic glowing focal orb
  ctx.save();
  const orbGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.14);
  orbGrad.addColorStop(0, '#ffffff');
  orbGrad.addColorStop(0.3, pal.accent1);
  orbGrad.addColorStop(0.7, pal.accent2);
  orbGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. High-end frame & typography
  ctx.save();
  // Outer border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 16, size - 32, size - 32);

  // Corner tick marks
  const tickLen = 8;
  ctx.strokeStyle = pal.accent1;
  ctx.lineWidth = 1.5;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(16, 16 + tickLen);
  ctx.lineTo(16, 16);
  ctx.lineTo(16 + tickLen, 16);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(size - 16 - tickLen, 16);
  ctx.lineTo(size - 16, 16);
  ctx.lineTo(size - 16, 16 + tickLen);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(16, size - 16 - tickLen);
  ctx.lineTo(16, size - 16);
  ctx.lineTo(16 + tickLen, size - 16);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(size - 16 - tickLen, size - 16);
  ctx.lineTo(size - 16, size - 16);
  ctx.lineTo(size - 16, size - 16 - tickLen);
  ctx.stroke();

  // Text metadata
  ctx.font = '600 10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillText('ABDAXIONIK HD', 24, 30);

  const setLabel = options.parameterSetName ? options.parameterSetName.toUpperCase() : `SET #${pSet}`;
  ctx.textAlign = 'right';
  ctx.fillText(setLabel, size - 24, 30);

  // Bottom Model Name & Spec
  ctx.textAlign = 'left';
  ctx.font = '700 12px sans-serif';
  ctx.fillStyle = '#ffffff';
  const cleanTitle = title.length > 28 ? title.slice(0, 26) + '...' : title;
  ctx.fillText(cleanTitle, 24, size - 24);

  ctx.textAlign = 'right';
  ctx.font = '500 10px monospace';
  ctx.fillStyle = pal.accent1;
  ctx.fillText(`${size}×${size} // 24-BIT`, size - 24, size - 24);
  ctx.restore();
}

function drawCrystallinePolygon(
  ctx: CanvasRenderingContext2D,
  radius: number,
  sides: number,
  pal: Palette
): void {
  ctx.strokeStyle = pal.accent1;
  ctx.lineWidth = 2;
  for (let s = 0.5; s <= 1.0; s += 0.25) {
    const r = radius * s;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawResonantRibbons(ctx: CanvasRenderingContext2D, radius: number, pal: Palette): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.accent1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const phase = (i * Math.PI) / 5;
    for (let a = 0; a <= Math.PI * 2; a += 0.1) {
      const r = radius * (0.8 + 0.25 * Math.sin(a * 4 + phase));
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.4 + i * 0.12;
    ctx.stroke();
  }
}

function drawRadialHarmonicBars(
  ctx: CanvasRenderingContext2D,
  radius: number,
  count: number,
  pal: Palette
): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = pal.accent1;
  for (let i = 0; i < count; i++) {
    const a = (i * 2 * Math.PI) / count;
    const len = radius * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.5)));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (radius * 0.4), Math.sin(a) * (radius * 0.4));
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
}

function drawLogarithmicSpiral(ctx: CanvasRenderingContext2D, radius: number, pal: Palette): void {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = pal.accent1;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 6; a += 0.08) {
    const r = (radius * (a / (Math.PI * 6))) * 0.95;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawBassShockwaves(ctx: CanvasRenderingContext2D, radius: number, pal: Palette): void {
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * (i / 4), radius * 0.7 * (i / 4), 0, 0, Math.PI * 2);
    ctx.lineWidth = 4.5 - i * 0.8;
    ctx.strokeStyle = i % 2 === 0 ? pal.accent1 : pal.accent2;
    ctx.stroke();
  }
}

function drawFormantEllipses(ctx: CanvasRenderingContext2D, radius: number, pal: Palette): void {
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * 0.45, 0, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? pal.accent1 : pal.accent2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawNebulaCurtain(ctx: CanvasRenderingContext2D, radius: number, pal: Palette): void {
  ctx.save();
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    const r = radius * (0.4 + i * 0.08);
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? pal.accent1 : pal.accent3;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  }
  ctx.restore();
}

function drawChimeStarburst(
  ctx: CanvasRenderingContext2D,
  radius: number,
  points: number,
  pal: Palette
): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.accent1;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const r = i % 2 === 0 ? radius : radius * 0.38;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawTransientBeatWheel(
  ctx: CanvasRenderingContext2D,
  radius: number,
  slices: number,
  pal: Palette
): void {
  ctx.lineWidth = 2;
  for (let i = 0; i < slices; i++) {
    const a = (i * 2 * Math.PI) / slices;
    const len = radius * (0.6 + 0.4 * (i % 3 === 0 ? 1 : 0.6));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.strokeStyle = i % 4 === 0 ? pal.accent1 : pal.accent2;
    ctx.stroke();
  }
}

function drawLissajousAcousticFigure(
  ctx: CanvasRenderingContext2D,
  radius: number,
  pal: Palette
): void {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = pal.accent1;
  ctx.beginPath();
  const aFreq = 3;
  const bFreq = 4;
  const delta = Math.PI / 2;
  for (let t = 0; t <= Math.PI * 2; t += 0.05) {
    const x = Math.sin(aFreq * t + delta) * radius;
    const y = Math.sin(bFreq * t) * radius;
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}
