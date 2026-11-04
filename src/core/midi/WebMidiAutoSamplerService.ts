// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 37.1: WebMIDI AutoSampler I/O Service (Spike 0)
//
// Provides browser/Electron WebMIDI access (`navigator.requestMIDIAccess`):
//   - Enumerates MIDIOutput ports (to trigger hardware synths / VSTs)
//     and MIDIInput ports (for live keyboard capture mode).
//   - Sends sample-scheduled or immediate NoteOn, NoteOff, and All-Notes-Off
//     (CC 123 / CC 120) panic messages.
//   - Captures incoming NoteOn, NoteOff, and Sustain Pedal (CC 64) events
//     with high-resolution timestamps (`performance.now()`) and maps them
//     to audio frame indices.
//   - Includes `runMidiJitterSmokeTest()` (Spike 0) to verify WebMIDI port
//     timing and measure scheduling jitter on 3 test notes.
// ─────────────────────────────────────────────────────────

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export type MidiPortDescriptor = MidiPortInfo;

export interface IncomingMidiNoteMessage {
  type: 'noteon' | 'noteoff' | 'sustain';
  channel: number; // 1..16
  midiNote: number; // 0..127 (or CC value for sustain)
  note: number; // alias of midiNote
  velocity: number; // 0..127
  timestampMs: number;
}

export interface MidiJitterSmokeTestResult {
  supported: boolean;
  hardwarePortConnected: boolean;
  measurementMode: 'midi_loopback' | 'webmidi_output' | 'timer_fallback';
  portName: string;
  notesTested: number;
  notesSent: number;
  hardwareNotesSent: number;
  meanJitterMs: number;
  avgJitterMs: number;
  maxJitterMs: number;
  passed: boolean;
  details: string;
}

export type IncomingMidiListener = (msg: IncomingMidiNoteMessage) => void;

export class WebMidiAutoSamplerService {
  private midiAccess: MIDIAccess | null = null;
  private selectedOutputId = '';
  private selectedInputId = '';
  private defaultChannel = 1;
  private boundInputPort: MIDIInput | null = null;
  private listeners = new Set<IncomingMidiListener>();
  private stateChangeListeners = new Set<() => void>();
  private sustainPedalDown = false;
  private sustainedNotes = new Set<string>(); // `${channel}:${note}` waiting for pedal release

  /** Returns true if the current browser/environment exposes WebMIDI. */
  public static isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  public setChannel(channel: number): void {
    this.defaultChannel = Math.max(1, Math.min(16, Math.round(channel)));
  }

  public getChannel(): number {
    return this.defaultChannel;
  }

  /** Requests WebMIDI access and returns current outputs/inputs. */
  public async requestAccess(): Promise<{
    supported: boolean;
    outputs: MidiPortInfo[];
    inputs: MidiPortInfo[];
  }> {
    const supported = await this.ensureAccess();
    return {
      supported,
      outputs: this.listOutputs(),
      inputs: this.listInputs(),
    };
  }

  /** Requests WebMIDI access (without SysEx to avoid extra permission friction). */
  public async ensureAccess(): Promise<boolean> {
    if (this.midiAccess) return true;
    if (!WebMidiAutoSamplerService.isSupported()) return false;
    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.midiAccess.onstatechange = () => {
        this.rebindInputPort();
        for (const cb of this.stateChangeListeners) cb();
      };
      const outputs = this.listOutputs();
      if (!this.selectedOutputId && outputs.length > 0) {
        this.selectedOutputId = outputs[0].id;
      }
      const inputs = this.listInputs();
      if (!this.selectedInputId && inputs.length > 0) {
        this.selectedInputId = inputs[0].id;
      }
      this.rebindInputPort();
      return true;
    } catch {
      this.midiAccess = null;
      return false;
    }
  }

  public listOutputs(): MidiPortInfo[] {
    if (!this.midiAccess) return [];
    const list: MidiPortInfo[] = [];
    this.midiAccess.outputs.forEach((port) => {
      list.push({
        id: port.id,
        name: port.name || `MIDI Out (${port.id})`,
        manufacturer: port.manufacturer || '',
        state: port.state || 'connected',
      });
    });
    return list;
  }

  public listInputs(): MidiPortInfo[] {
    if (!this.midiAccess) return [];
    const list: MidiPortInfo[] = [];
    this.midiAccess.inputs.forEach((port) => {
      list.push({
        id: port.id,
        name: port.name || `MIDI In (${port.id})`,
        manufacturer: port.manufacturer || '',
        state: port.state || 'connected',
      });
    });
    return list;
  }

  public setSelectedOutputId(id: string): void {
    this.selectedOutputId = id;
  }

  public getSelectedOutputId(): string {
    return this.selectedOutputId;
  }

  public setSelectedInputId(id: string): void {
    this.selectedInputId = id;
    this.rebindInputPort();
  }

  public getSelectedInputId(): string {
    return this.selectedInputId;
  }

  public onPortsChanged(cb: () => void): () => void {
    this.stateChangeListeners.add(cb);
    return () => this.stateChangeListeners.delete(cb);
  }

  public onIncomingMidi(cb: IncomingMidiListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public onInputMessage(cb: IncomingMidiListener): () => void {
    return this.onIncomingMidi(cb);
  }

  /** Sends a MIDI NoteOn (`0x90 | ch`) on the selected output port. */
  public sendNoteOn(
    midiNote: number,
    velocity: number,
    channel = this.defaultChannel,
    timestampMs?: number
  ): boolean {
    const out = this.getActiveOutputPort();
    if (!out) return false;
    const ch = Math.max(1, Math.min(16, Math.round(channel))) - 1;
    const note = Math.max(0, Math.min(127, Math.round(midiNote)));
    const vel = Math.max(1, Math.min(127, Math.round(velocity)));
    try {
      if (timestampMs !== undefined && Number.isFinite(timestampMs)) {
        out.send([0x90 | ch, note, vel], timestampMs);
      } else {
        out.send([0x90 | ch, note, vel]);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Sends a MIDI NoteOff (`0x80 | ch`) on the selected output port. */
  public sendNoteOff(
    midiNote: number,
    channel = this.defaultChannel,
    timestampMs?: number
  ): boolean {
    const out = this.getActiveOutputPort();
    if (!out) return false;
    const ch = Math.max(1, Math.min(16, Math.round(channel))) - 1;
    const note = Math.max(0, Math.min(127, Math.round(midiNote)));
    try {
      if (timestampMs !== undefined && Number.isFinite(timestampMs)) {
        out.send([0x80 | ch, note, 0], timestampMs);
      } else {
        out.send([0x80 | ch, note, 0]);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Sends All Sound Off (CC 120) + All Notes Off (CC 123) to prevent stuck notes when pausing/stopping. */
  public sendAllNotesOff(channel = this.defaultChannel): void {
    const out = this.getActiveOutputPort();
    if (!out) return;
    const ch = Math.max(1, Math.min(16, Math.round(channel))) - 1;
    try {
      out.send([0xb0 | ch, 123, 0]);
      out.send([0xb0 | ch, 120, 0]);
    } catch {
      // Ignore port errors on panic
    }
  }

  /**
   * Fase 37.1 Spike 0: Fires 3 short test notes (C4, E4, G4) on the active MIDI
   * Output port (measuring true MIDI loopback timestamps when an Input port is looped
   * back, WebMIDI send dispatch + clock jitter when an Output port is connected,
   * or clearly labelled host timer fallback when no physical port is connected).
   */
  public async runMidiJitterSmokeTest(
    gateMs = 35,
    channel = this.defaultChannel
  ): Promise<MidiJitterSmokeTestResult> {
    const hasAccess = await this.ensureAccess();
    const out = this.getActiveOutputPort();
    const hasHardwarePort = out !== null;
    const portName =
      out?.name || (hasAccess ? 'Reloj Host (sin MIDI Out conectado)' : 'Reloj Host (WebMIDI no disponible)');
    const testNotes = [60, 64, 67];
    const targetWaitMs = Math.max(15, Math.min(120, Math.round(gateMs)));
    const jitters: number[] = [];
    let hardwareNotesSent = 0;
    let loopbackHits = 0;

    let lastSentTs = 0;
    const tempUnsub = this.onInputMessage((msg) => {
      if (msg.type === 'noteon' && lastSentTs > 0) {
        loopbackHits += 1;
        jitters.push(Math.abs(msg.timestampMs - lastSentTs));
      }
    });

    try {
      for (const note of testNotes) {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        lastSentTs = t0;
        if (out) {
          if (this.sendNoteOn(note, 96, channel, t0)) {
            hardwareNotesSent += 1;
          }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, targetWaitMs));
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (out) {
          this.sendNoteOff(note, channel, t1);
        }
        if (loopbackHits === 0) {
          const actualWait = t1 - t0;
          jitters.push(Math.abs(actualWait - targetWaitMs));
        }
      }
    } finally {
      tempUnsub();
    }

    const meanJitterMs =
      Math.round((jitters.reduce((a, b) => a + b, 0) / Math.max(1, jitters.length)) * 100) / 100;
    const maxJitterMs = Math.round(Math.max(0, ...jitters) * 100) / 100;
    const measurementMode: MidiJitterSmokeTestResult['measurementMode'] =
      loopbackHits > 0 ? 'midi_loopback' : hasHardwarePort ? 'webmidi_output' : 'timer_fallback';
    const notesSent = hasHardwarePort ? hardwareNotesSent : testNotes.length;
    const thresholdMs = measurementMode === 'timer_fallback' ? 25 : 15;

    return {
      supported: hasAccess,
      hardwarePortConnected: hasHardwarePort,
      measurementMode,
      portName,
      notesTested: testNotes.length,
      notesSent,
      hardwareNotesSent,
      meanJitterMs,
      avgJitterMs: meanJitterMs,
      maxJitterMs,
      passed: maxJitterMs < thresholdMs && (!hasHardwarePort || hardwareNotesSent === testNotes.length),
      details: `${portName} [${measurementMode}]: ${notesSent}/${testNotes.length} notas (C4, E4, G4) · Jitter medio ${meanJitterMs} ms (máx ${maxJitterMs} ms)`,
    };
  }

  /**
   * Injects a synthetic incoming MIDI message (used by unit tests and on-screen
   * keyboard bridges when testing Live MIDI Capture without a physical controller).
   */
  public dispatchIncomingMessage(rawBytes: ArrayLike<number>, timestampMs?: number): void {
    if (!rawBytes || rawBytes.length < 2) return;
    const status = rawBytes[0] & 0xf0;
    const channel = (rawBytes[0] & 0x0f) + 1;
    const data1 = rawBytes[1] & 0x7f;
    const data2 = rawBytes.length > 2 ? rawBytes[2] & 0x7f : 0;
    const ts =
      timestampMs !== undefined && Number.isFinite(timestampMs)
        ? timestampMs
        : typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();

    if (status === 0x90 && data2 > 0) {
      this.sustainedNotes.delete(`${channel}:${data1}`);
      this.emitIncoming({
        type: 'noteon',
        channel,
        midiNote: data1,
        note: data1,
        velocity: data2,
        timestampMs: ts,
      });
    } else if (status === 0x80 || (status === 0x90 && data2 === 0)) {
      if (this.sustainPedalDown) {
        this.sustainedNotes.add(`${channel}:${data1}`);
      } else {
        this.emitIncoming({
          type: 'noteoff',
          channel,
          midiNote: data1,
          note: data1,
          velocity: 0,
          timestampMs: ts,
        });
      }
    } else if (status === 0xb0 && data1 === 64) {
      const pedalDown = data2 >= 64;
      const wasDown = this.sustainPedalDown;
      this.sustainPedalDown = pedalDown;
      this.emitIncoming({
        type: 'sustain',
        channel,
        midiNote: 64,
        note: 64,
        velocity: data2,
        timestampMs: ts,
      });
      if (wasDown && !pedalDown && this.sustainedNotes.size > 0) {
        for (const key of this.sustainedNotes) {
          const [chStr, noteStr] = key.split(':');
          const n = Number(noteStr) || 60;
          this.emitIncoming({
            type: 'noteoff',
            channel: Number(chStr) || channel,
            midiNote: n,
            note: n,
            velocity: 0,
            timestampMs: ts,
          });
        }
        this.sustainedNotes.clear();
      }
    }
  }

  private emitIncoming(msg: IncomingMidiNoteMessage): void {
    for (const cb of this.listeners) {
      cb(msg);
    }
  }

  private getActiveOutputPort(): MIDIOutput | null {
    if (!this.midiAccess) return null;
    if (this.selectedOutputId && this.midiAccess.outputs.has(this.selectedOutputId)) {
      return this.midiAccess.outputs.get(this.selectedOutputId) ?? null;
    }
    const first = this.midiAccess.outputs.values().next();
    return first.done ? null : first.value;
  }

  private rebindInputPort(): void {
    if (this.boundInputPort) {
      this.boundInputPort.onmidimessage = null;
      this.boundInputPort = null;
    }
    if (!this.midiAccess) return;
    let target: MIDIInput | null = null;
    if (this.selectedInputId && this.midiAccess.inputs.has(this.selectedInputId)) {
      target = this.midiAccess.inputs.get(this.selectedInputId) ?? null;
    } else {
      const first = this.midiAccess.inputs.values().next();
      target = first.done ? null : first.value;
    }
    if (!target) return;
    this.boundInputPort = target;
    this.boundInputPort.onmidimessage = (ev: MIDIMessageEvent) => {
      if (ev.data) {
        this.dispatchIncomingMessage(ev.data, ev.timeStamp);
      }
    };
  }
}
