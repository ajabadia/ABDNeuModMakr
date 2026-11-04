

export function getThemeColors(): {
    bg: string;
    waveform: string;
    waveformGradientEnd: string;
    sliceSel: string;
    sliceEven: string;
    sliceOdd: string;
    silence: string;
    silenceStripe: string;
    silenceWaveform: string;
    silenceBadgeBg: string;
    silenceBadgeText: string;
    marker: string;
    markerHover: string;
    markerManual: string;
    markerManualHover: string;
    markerActive: string;
    markerActiveManual: string;
    centerLine: string;
    text: string;
  } {
  const style = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null;
  const token = (name: string, fallback = 'currentColor') =>
    style?.getPropertyValue(name).trim() || fallback;

  const accent = token('--color-accent');
  const warn = token('--color-warning');
  const success = token('--color-success', accent);
  const bg = token('--color-lcd-bg', token('--color-panel-bg', 'transparent'));
  const textMain = token('--color-text-main');
  const textDim = token('--color-text-dim');
  const borderDim = token('--color-panel-border-dim');
  const surfaceElev = token('--color-panel-surface-elevated', bg);

  return {
    bg,
    waveform: accent,
    waveformGradientEnd: token('--color-accent-strong', accent),
    sliceSel: token('--color-accent-dim', surfaceElev),
    sliceEven: surfaceElev,
    sliceOdd: bg,
    silence: surfaceElev,
    silenceStripe: borderDim,
    silenceWaveform: textDim,
    silenceBadgeBg: surfaceElev,
    silenceBadgeText: textDim,
    marker: accent,
    markerHover: accent,
    markerManual: warn,
    markerManualHover: warn,
    markerActive: success,
    markerActiveManual: warn,
    centerLine: borderDim,
    text: textMain,
  };
}
