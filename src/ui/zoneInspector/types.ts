import type { ExtendedRegion, KeyMappingMode, WorkingMode, Zone } from '../../core/types.ts';
import type { Knob } from '@abdsynths/shared/components';
import type { ZoneInspectorHandlers } from '../ZoneInspector.ts';

export interface InspectorState {
  drawerElement: HTMLElement | null;
  currentZone: Zone | null;
  allZones: Zone[];
  zoneIndex: number;
  workingMode: WorkingMode;
  handlers: ZoneInspectorHandlers;
  keyMappingMode: KeyMappingMode;
  container: HTMLElement;
  isDraggingKnob: boolean;
  detuneKnob: Knob | null;
  volumeKnob: Knob | null;
  panKnob: Knob | null;
  activeNoteHits: Map<number, { zoneId?: string; layer?: 'low' | 'high'; regionIds: string[]; startedAt: number }>;
  isPlayingSequence: boolean;
  isSpectralVisible: boolean;
  totalZones: number;
}

export interface InspectorContext {
  state: InspectorState;
  destroyZoneKnobs: () => void;
  getExtendedContext: () => { regions: ExtendedRegion[]; activeRegion: ExtendedRegion | null; activeIndex: number };
  renderGmDrumOptions: (currentKey: number, currentId: string) => string;
  bindDrawerEvents: () => void;
  getEffectiveBpm: () => number;
  bindTableEvents: () => void;
  renderZoneTableRows: (zones: Zone[], activeId: string) => string;
  renderExtendedRegionTableRows: (regions: ExtendedRegion[], activeRegionId: string) => string;
  closeDrawer: () => void;
  renderDrawer: () => void;
  handleRowPlayClick: (zoneId: string | null, regionId: string | null) => void;
  bindDrawerMetadataEvents: () => void;
}
