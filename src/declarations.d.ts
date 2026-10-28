declare module '@abdsynths/midi-keyb' {
  export interface KeyboardZone {
    id?: string | number;
    lowKey: number;
    highKey: number;
    rootKey?: number;
    color?: string;
  }

  export interface KeyboardConfig {
    numOctaves?: number;
    startNote?: number;
    fixedOctaves?: boolean;
    maxOctaveShift?: number;
    velocitySource?: string;
    velocityCurve?: string;
    fixedVelocity?: number;
    ledColor?: string | null;
    enablePressureDisplay?: boolean;
    enablePitchBendDisplace?: boolean;
    enableIvoryTexture?: boolean;
    enableVintageWear?: boolean;
    enableQwerty?: boolean;
    showQwertyLabels?: boolean;
    enableTouch?: boolean;
    enableAftertouch?: boolean;
    enableAccessibility?: boolean;
    enableCollapse?: boolean;
    enableResizeObserver?: boolean;
    enablePanic?: boolean;
    enableWheels?: boolean;
    enableSustain?: boolean;
    enableHold?: boolean;
    enableRetrig?: boolean;
    enableSostenuto?: boolean;
    enableSoftPedal?: boolean;
    zones?: KeyboardZone[];
    activeZoneIndex?: number | string;
  }

  export interface KeyboardDeps {
    containerId?: string;
    wheelPitchId?: string | null;
    wheelModId?: string | null;
    octUpId?: string | null;
    octDownId?: string | null;
    panicBtnId?: string | null;
    onNoteOn?: (note: number) => void;
    onNoteOff?: (note: number) => void;
    onPitchBend?: (value: number) => void;
    onModWheel?: (value: number) => void;
    onCollapseChange?: (collapsed: boolean) => void;
    config?: KeyboardConfig;
  }

  export interface KeyboardInstance {
    destroy: () => void;
    panic: () => void;
    setOctaveCount: (numOctaves: number, startNote?: number) => void;
    setZones: (zones: KeyboardZone[], activeZoneIndex?: number | string | null) => void;
    setActiveZone: (indexOrId: number | string | null) => void;
    getZones: () => KeyboardZone[];
    getActiveZone: () => number | string;
    getActiveNotes: () => number[];
    setPitchBend: (val: number) => void;
    setModWheel: (val: number) => void;
  }

  export function createKeyboard(deps?: KeyboardDeps): KeyboardInstance;
}
