import type { InspectorContext } from './types.ts';
import type { CrossfadeCurve, ExtendedRegion, LoopMode, MasterChannelLayout, MasterPromotionMethod, MasterWaveConfig, TriggerMode, Zone } from '../../core/types.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../../core/dsp/MasterWaveEnhancer.ts';
import { createDefaultCommonPlayback } from '../../core/extendedAdapter.ts';

export function bindDrawerSampleLowEvents(ui: InspectorContext, z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  // Sample Low / Region Sample actions
  const fileInputLow = ui.state.drawerElement.querySelector('#file-input-low') as HTMLInputElement | null;
  ui.state.drawerElement.querySelector('#btn-browse-low')?.addEventListener('click', () => {
    if (fileInputLow) {
      fileInputLow.click();
    }
  });

  fileInputLow?.addEventListener('change', () => {
    const files = fileInputLow.files;
    if (!files || files.length === 0) return;
    if (files.length > 1 && ui.state.handlers.onDropMultipleFiles) {
      ui.state.handlers.onDropMultipleFiles(files);
    } else if (isExtended && activeReg && ui.state.handlers.onLoadSampleFileIntoRegion) {
      ui.state.handlers.onLoadSampleFileIntoRegion(activeReg.id, files[0]);
    } else if (ui.state.handlers.onLoadSampleFile) {
      ui.state.handlers.onLoadSampleFile(z.id, 'low', files[0]);
    }
  });

  const cardLow = ui.state.drawerElement.querySelector('#card-sample-low') as HTMLElement | null;
  cardLow?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cardLow.classList.add('is-dragover');
  });
  cardLow?.addEventListener('dragleave', () => {
    cardLow.classList.remove('is-dragover');
  });
  cardLow?.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cardLow.classList.remove('is-dragover');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1 && ui.state.handlers.onDropMultipleFiles) {
      ui.state.handlers.onDropMultipleFiles(files);
    } else if (isExtended && activeReg && ui.state.handlers.onLoadSampleFileIntoRegion) {
      ui.state.handlers.onLoadSampleFileIntoRegion(activeReg.id, files[0]);
    } else if (ui.state.handlers.onLoadSampleFile) {
      ui.state.handlers.onLoadSampleFile(z.id, 'low', files[0]);
    }
  });

  ui.state.drawerElement.querySelector('#btn-clear-low')?.addEventListener('click', () => {
    if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
      ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { sampleName: '' });
      return;
    }
    if (z.sampleHigh) {
      ui.state.handlers.onUpdateZone(z.id, { sampleLow: z.sampleHigh, sampleHigh: null });
    } else {
      ui.state.handlers.onUpdateZone(z.id, { sampleLow: null });
    }
  });

  ui.state.drawerElement.querySelector('#btn-play-low')?.addEventListener('click', () => {
    ui.handleRowPlayClick(z.id, isExtended && activeReg ? activeReg.id : null);
  });

  ui.state.drawerElement.querySelector('.drawer-waveform-play-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ui.handleRowPlayClick(z.id, isExtended && activeReg ? activeReg.id : null);
  });
}

export function bindDrawerSampleHighEvents(ui: InspectorContext, z: Zone): void {
  if (!ui.state.drawerElement) return;
  // Sample High actions (Classic Mode)
  const fileInputHigh = ui.state.drawerElement.querySelector('#file-input-high') as HTMLInputElement | null;
  ui.state.drawerElement.querySelector('#btn-browse-high')?.addEventListener('click', () => {
    if (ui.state.handlers.onLoadSampleFile && fileInputHigh) {
      fileInputHigh.click();
    }
  });

  fileInputHigh?.addEventListener('change', () => {
    const file = fileInputHigh.files?.[0];
    if (file && ui.state.handlers.onLoadSampleFile) {
      ui.state.handlers.onLoadSampleFile(z.id, 'high', file);
    }
  });

  const cardHigh = ui.state.drawerElement.querySelector('#card-sample-high') as HTMLElement | null;
  cardHigh?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cardHigh.classList.add('is-dragover');
  });
  cardHigh?.addEventListener('dragleave', () => {
    cardHigh.classList.remove('is-dragover');
  });
  cardHigh?.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cardHigh.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && ui.state.handlers.onLoadSampleFile) {
      ui.state.handlers.onLoadSampleFile(z.id, 'high', file);
    }
  });

  ui.state.drawerElement.querySelector('#btn-clear-high')?.addEventListener('click', () => {
    ui.state.handlers.onUpdateZone(z.id, { sampleHigh: null });
  });

  ui.state.drawerElement.querySelector('#btn-play-high')?.addEventListener('click', () => {
    if (z.sampleHigh) ui.state.handlers.onAuditionSample(z.sampleHigh);
  });
}

export function bindDrawerExtendedRegionEvents(ui: InspectorContext, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  // Extended Region Loop, Inheritance & Custom Override events
  const extSection = ui.state.drawerElement.querySelector('.section-extended-region');
  const extRegionId = extSection?.getAttribute('data-ext-region-id') || '';
  if (extRegionId && ui.state.handlers.onUpdateExtendedRegion) {
    const updateReg = (changes: Partial<ExtendedRegion>) => {
      ui.state.handlers.onUpdateExtendedRegion?.(extRegionId, changes);
    };

    const chkPbOverride = ui.state.drawerElement.querySelector(
      '#chk-reg-playback-override'
    ) as HTMLInputElement | null;
    chkPbOverride?.addEventListener('change', () => {
      const enableOverride = Boolean(chkPbOverride.checked);
      const commonPb =
        ui.state.handlers.getCommonPlayback?.() ?? createDefaultCommonPlayback();
      if (enableOverride) {
        updateReg({
          hasPlaybackOverride: true,
          loopMode: activeReg?.loopMode ?? commonPb.loopMode,
          pitchKeytrack: activeReg?.pitchKeytrack ?? commonPb.pitchKeytrack,
          trigger: activeReg?.trigger ?? commonPb.trigger,
          fadeCurve: activeReg?.fadeCurve ?? commonPb.fadeCurve,
        });
      } else {
        updateReg({
          hasPlaybackOverride: false,
          loopMode: commonPb.loopMode,
          pitchKeytrack: commonPb.pitchKeytrack,
          trigger: commonPb.trigger,
          fadeCurve: commonPb.fadeCurve,
        });
      }
    });

    const chkArtOverride = ui.state.drawerElement.querySelector(
      '#chk-reg-art-override'
    ) as HTMLInputElement | null;
    chkArtOverride?.addEventListener('change', () => {
      const enableArtOvr = Boolean(chkArtOverride.checked);
      const globalArt = ui.state.handlers.getArticulation?.();
      if (enableArtOvr) {
        updateReg({
          hasArticulationOverride: true,
          ampEnvOverride: activeReg?.ampEnvOverride ?? {
            attackSec: globalArt?.ampEnv.attackSec ?? 0.005,
            decaySec: globalArt?.ampEnv.decaySec ?? 0.25,
            sustainLevel: globalArt?.ampEnv.sustainLevel ?? 1.0,
            releaseSec: globalArt?.ampEnv.releaseSec ?? 0.2,
          },
          filterOverride: activeReg?.filterOverride ?? {
            cutoffHz: globalArt?.filter.cutoffHz ?? 18000,
            resonanceDb: globalArt?.filter.resonanceDb ?? 0,
          },
        });
      } else {
        updateReg({
          hasArticulationOverride: false,
          ampEnvOverride: undefined,
          filterOverride: undefined,
        });
      }
    });

    const bindRegionArtOverrideInputs = () => {
      if (!activeReg) return;
      const inpA = ui.state.drawerElement?.querySelector('#inp-reg-amp-a') as HTMLInputElement | null;
      const inpD = ui.state.drawerElement?.querySelector('#inp-reg-amp-d') as HTMLInputElement | null;
      const inpS = ui.state.drawerElement?.querySelector('#inp-reg-amp-s') as HTMLInputElement | null;
      const inpR = ui.state.drawerElement?.querySelector('#inp-reg-amp-r') as HTMLInputElement | null;
      const inpCut = ui.state.drawerElement?.querySelector('#inp-reg-flt-cut') as HTMLInputElement | null;
      const inpReso = ui.state.drawerElement?.querySelector('#inp-reg-flt-reso') as HTMLInputElement | null;

      updateReg({
        hasArticulationOverride: true,
        ampEnvOverride: {
          attackSec: Math.max(0.002, parseFloat(inpA?.value ?? '0.005') || 0.005),
          decaySec: Math.max(0.005, parseFloat(inpD?.value ?? '0.25') || 0.25),
          sustainLevel: Math.max(0, Math.min(1, parseFloat(inpS?.value ?? '1') || 0)),
          releaseSec: Math.max(0.01, parseFloat(inpR?.value ?? '0.2') || 0.2),
        },
        filterOverride: {
          cutoffHz: Math.max(20, Math.min(20000, parseFloat(inpCut?.value ?? '18000') || 18000)),
          resonanceDb: Math.max(0, Math.min(40, parseFloat(inpReso?.value ?? '0') || 0)),
        },
      });
    };

    for (const sel of [
      '#inp-reg-amp-a',
      '#inp-reg-amp-d',
      '#inp-reg-amp-s',
      '#inp-reg-amp-r',
      '#inp-reg-flt-cut',
      '#inp-reg-flt-reso',
    ]) {
      ui.state.drawerElement
        .querySelector(sel)
        ?.addEventListener('change', bindRegionArtOverrideInputs);
    }

    const selLoopMode = ui.state.drawerElement.querySelector('#sel-ext-loop-mode') as HTMLSelectElement | null;
    selLoopMode?.addEventListener('change', () => {
      updateReg({ hasPlaybackOverride: true, loopMode: selLoopMode.value as LoopMode });
    });

    const inpLoopStart = ui.state.drawerElement.querySelector('#inp-ext-loop-start') as HTMLInputElement | null;
    inpLoopStart?.addEventListener('change', () => {
      updateReg({ loopStart: Math.max(0, parseInt(inpLoopStart.value, 10) || 0) });
    });

    const inpLoopEnd = ui.state.drawerElement.querySelector('#inp-ext-loop-end') as HTMLInputElement | null;
    inpLoopEnd?.addEventListener('change', () => {
      updateReg({ loopEnd: Math.max(0, parseInt(inpLoopEnd.value, 10) || 0) });
    });

    const inpLoopXfade = ui.state.drawerElement.querySelector('#inp-ext-loop-xfade') as HTMLInputElement | null;
    inpLoopXfade?.addEventListener('change', () => {
      updateReg({ loopCrossfadeMs: Math.max(0, parseInt(inpLoopXfade.value, 10) || 0) });
    });

    const inpKeytrack = ui.state.drawerElement.querySelector('#inp-ext-keytrack') as HTMLInputElement | null;
    inpKeytrack?.addEventListener('change', () => {
      updateReg({
        hasPlaybackOverride: true,
        pitchKeytrack: Math.max(0, Math.min(100, parseInt(inpKeytrack.value, 10) || 0)),
      });
    });

    const inpKeyFadeIn = ui.state.drawerElement.querySelector('#inp-ext-key-fade-in') as HTMLInputElement | null;
    inpKeyFadeIn?.addEventListener('change', () => {
      updateReg({ keyFadeIn: Math.max(0, parseInt(inpKeyFadeIn.value, 10) || 0) });
    });

    const inpKeyFadeOut = ui.state.drawerElement.querySelector('#inp-ext-key-fade-out') as HTMLInputElement | null;
    inpKeyFadeOut?.addEventListener('change', () => {
      updateReg({ keyFadeOut: Math.max(0, parseInt(inpKeyFadeOut.value, 10) || 0) });
    });

    const selTrigger = ui.state.drawerElement.querySelector('#sel-ext-trigger') as HTMLSelectElement | null;
    selTrigger?.addEventListener('change', () => {
      updateReg({ hasPlaybackOverride: true, trigger: selTrigger.value as TriggerMode });
    });

    const inpVelFadeIn = ui.state.drawerElement.querySelector('#inp-ext-vel-fade-in') as HTMLInputElement | null;
    inpVelFadeIn?.addEventListener('change', () => {
      updateReg({ velFadeIn: Math.max(0, Math.min(127, parseInt(inpVelFadeIn.value, 10) || 0)) });
    });

    const inpVelFadeOut = ui.state.drawerElement.querySelector('#inp-ext-vel-fade-out') as HTMLInputElement | null;
    inpVelFadeOut?.addEventListener('change', () => {
      updateReg({ velFadeOut: Math.max(0, Math.min(127, parseInt(inpVelFadeOut.value, 10) || 0)) });
    });

    const selFadeCurve = ui.state.drawerElement.querySelector('#sel-ext-fade-curve') as HTMLSelectElement | null;
    selFadeCurve?.addEventListener('change', () => {
      updateReg({ hasPlaybackOverride: true, fadeCurve: selFadeCurve.value as CrossfadeCurve });
    });
  }
}

export function bindDrawerCommonPlaybackEvents(ui: InspectorContext): void {
  if (!ui.state.drawerElement) return;
  // Model Common Playback Defaults bindings
  if (ui.state.handlers.onUpdateCommonPlayback) {
    const selCommonLoop = ui.state.drawerElement.querySelector(
      '#sel-common-loop-mode'
    ) as HTMLSelectElement | null;
    selCommonLoop?.addEventListener('change', () => {
      ui.state.handlers.onUpdateCommonPlayback?.({
        loopMode: selCommonLoop.value as LoopMode,
      });
    });

    const inpCommonKeytrack = ui.state.drawerElement.querySelector(
      '#inp-common-keytrack'
    ) as HTMLInputElement | null;
    inpCommonKeytrack?.addEventListener('change', () => {
      ui.state.handlers.onUpdateCommonPlayback?.({
        pitchKeytrack: Math.max(
          0,
          Math.min(100, parseInt(inpCommonKeytrack.value, 10) || 0)
        ),
      });
    });

    const selCommonTrigger = ui.state.drawerElement.querySelector(
      '#sel-common-trigger'
    ) as HTMLSelectElement | null;
    selCommonTrigger?.addEventListener('change', () => {
      ui.state.handlers.onUpdateCommonPlayback?.({
        trigger: selCommonTrigger.value as TriggerMode,
      });
    });

    const selCommonFadeCurve = ui.state.drawerElement.querySelector(
      '#sel-common-fade-curve'
    ) as HTMLSelectElement | null;
    selCommonFadeCurve?.addEventListener('change', () => {
      ui.state.handlers.onUpdateCommonPlayback?.({
        fadeCurve: selCommonFadeCurve.value as CrossfadeCurve,
      });
    });

    ui.state.drawerElement
      .querySelector('#btn-reset-all-pb-overrides')
      ?.addEventListener('click', () => {
        ui.state.handlers.onUpdateCommonPlayback?.({}, true);
      });
  }
}

export function bindDrawerArticulationEvents(ui: InspectorContext, z: Zone): void {
  if (!ui.state.drawerElement) return;
  if (ui.state.handlers.onUpdateArticulation && ui.state.handlers.getArticulation) {
    const bindArt = () => {
      const curr = ui.state.handlers.getArticulation!();
      const chkAmp = ui.state.drawerElement?.querySelector('#chk-art-amp-env') as HTMLInputElement | null;
      const chkBake = ui.state.drawerElement?.querySelector('#chk-art-bake-env') as HTMLInputElement | null;
      const inpAmpA = ui.state.drawerElement?.querySelector('#inp-art-amp-a') as HTMLInputElement | null;
      const inpAmpD = ui.state.drawerElement?.querySelector('#inp-art-amp-d') as HTMLInputElement | null;
      const inpAmpS = ui.state.drawerElement?.querySelector('#inp-art-amp-s') as HTMLInputElement | null;
      const inpAmpR = ui.state.drawerElement?.querySelector('#inp-art-amp-r') as HTMLInputElement | null;

      const chkFlt = ui.state.drawerElement?.querySelector('#chk-art-filter') as HTMLInputElement | null;
      const selFltType = ui.state.drawerElement?.querySelector('#sel-art-filter-type') as HTMLSelectElement | null;
      const inpFltCut = ui.state.drawerElement?.querySelector('#inp-art-filter-cutoff') as HTMLInputElement | null;
      const inpFltReso = ui.state.drawerElement?.querySelector('#inp-art-filter-reso') as HTMLInputElement | null;

      const chkLfo = ui.state.drawerElement?.querySelector('#chk-art-lfo') as HTMLInputElement | null;
      const inpLfoFreq = ui.state.drawerElement?.querySelector('#inp-art-lfo-freq') as HTMLInputElement | null;
      const inpLfoDelay = ui.state.drawerElement?.querySelector('#inp-art-lfo-delay') as HTMLInputElement | null;
      const inpLfoPitch = ui.state.drawerElement?.querySelector('#inp-art-lfo-pitch') as HTMLInputElement | null;

      ui.state.handlers.onUpdateArticulation!({
        ampEnvEnabled: Boolean(chkAmp?.checked),
        bakeEnvelopeIntoWave: Boolean(chkBake?.checked),
        ampEnv: {
          ...curr.ampEnv,
          attackSec: Math.max(0.002, parseFloat(inpAmpA?.value ?? String(curr.ampEnv.attackSec)) || 0.005),
          decaySec: Math.max(0.005, parseFloat(inpAmpD?.value ?? String(curr.ampEnv.decaySec)) || 0.25),
          sustainLevel: Math.max(0, Math.min(1, parseFloat(inpAmpS?.value ?? String(curr.ampEnv.sustainLevel)) || 0)),
          releaseSec: Math.max(0.01, parseFloat(inpAmpR?.value ?? String(curr.ampEnv.releaseSec)) || 0.2),
        },
        filter: {
          ...curr.filter,
          enabled: Boolean(chkFlt?.checked),
          type: (selFltType?.value === 'hpf' || selFltType?.value === 'bpf' ? selFltType.value : 'lpf'),
          cutoffHz: Math.max(20, Math.min(20000, parseFloat(inpFltCut?.value ?? String(curr.filter.cutoffHz)) || 18000)),
          resonanceDb: Math.max(0, Math.min(40, parseFloat(inpFltReso?.value ?? String(curr.filter.resonanceDb)) || 0)),
        },
        vibLfo: {
          ...curr.vibLfo,
          enabled: Boolean(chkLfo?.checked),
          freqHz: Math.max(0.05, Math.min(50, parseFloat(inpLfoFreq?.value ?? String(curr.vibLfo.freqHz)) || 5)),
          delaySec: Math.max(0, Math.min(10, parseFloat(inpLfoDelay?.value ?? String(curr.vibLfo.delaySec)) || 0)),
          toPitchCents: Math.max(-1200, Math.min(1200, parseFloat(inpLfoPitch?.value ?? String(curr.vibLfo.toPitchCents)) || 0)),
        },
      });
    };

    const artSelectors = [
      '#chk-art-amp-env',
      '#chk-art-bake-env',
      '#inp-art-amp-a',
      '#inp-art-amp-d',
      '#inp-art-amp-s',
      '#inp-art-amp-r',
      '#chk-art-filter',
      '#sel-art-filter-type',
      '#inp-art-filter-cutoff',
      '#inp-art-filter-reso',
      '#chk-art-lfo',
      '#inp-art-lfo-freq',
      '#inp-art-lfo-delay',
      '#inp-art-lfo-pitch',
    ];
    for (const sel of artSelectors) {
      ui.state.drawerElement.querySelector(sel)?.addEventListener('change', bindArt);
    }

    // Fase 8 Master Wave promotion bindings
    const readMwConfig = (): Partial<MasterWaveConfig> => {
      const fallback =
        ui.state.handlers.getMasterWaveConfig?.() ?? DEFAULT_MASTER_WAVE_CONFIG;
      const selMethod = ui.state.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-method');
      const selChannels = ui.state.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-channels');
      const inpLoopSec = ui.state.drawerElement?.querySelector<HTMLInputElement>('#inp-mw-loop-sec');
      const chkBwe = ui.state.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-bwe');
      const chkDenoise = ui.state.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-denoise');

      const pm = selMethod?.value ?? fallback.promotionMethod;
      const cl = selChannels?.value ?? fallback.channelLayout;
      return {
        promotionMethod:
          pm === 'direct-conversion' || pm === 'ai-bridge'
            ? (pm as MasterPromotionMethod)
            : 'dsp-enhanced',
        channelLayout:
          cl === 'stereo' || cl === 'quad-surround'
            ? (cl as MasterChannelLayout)
            : 'original',
        targetSampleRate: 96000,
        targetBitDepth: 24,
        minLoopDurationSec: Math.max(
          0,
          Math.min(30, parseFloat(inpLoopSec?.value ?? String(fallback.minLoopDurationSec)) || 0)
        ),
        enableBandwidthExtension: Boolean(chkBwe ? chkBwe.checked : fallback.enableBandwidthExtension),
        enableDenoiseGate: Boolean(chkDenoise ? chkDenoise.checked : fallback.enableDenoiseGate),
      };
    };

    ui.state.drawerElement
      .querySelector('#btn-promote-zone-mw')
      ?.addEventListener('click', () => {
        ui.state.handlers.onPromoteZoneToMasterWave?.(z.id, readMwConfig());
      });

    ui.state.drawerElement
      .querySelector('#btn-promote-zone-mw-reg')
      ?.addEventListener('click', () => {
        ui.state.handlers.onPromoteZoneToMasterWave?.(z.id, readMwConfig());
      });

    ui.state.drawerElement
      .querySelector('#btn-promote-all-mw')
      ?.addEventListener('click', () => {
        ui.state.handlers.onPromoteAllZonesToMasterWave?.(readMwConfig());
      });

    ui.state.drawerElement
      .querySelector('#btn-reprocess-purest')
      ?.addEventListener('click', () => {
        ui.state.handlers.onReprocessFromPurestSource?.();
      });

    ui.state.drawerElement
      .querySelector('#btn-export-time-capsule')
      ?.addEventListener('click', () => {
        ui.state.handlers.onExportTimeCapsule?.();
      });

    ui.bindDrawerMetadataEvents();
  }
}
