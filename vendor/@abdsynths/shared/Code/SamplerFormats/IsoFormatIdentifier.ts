// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Unified ISO / Floppy / SCSI Disk Image Format Identifier
//
// Clean-room TypeScript implementation identifying disk image formats:
//   - Akai S1000 / S1100 / S2000 / S3000 SCSI & CD-ROM images
//   - Akai S900 / S950 3.5" floppy disk images
//   - Akai MPC2000 / MPC2000XL floppy images
//   - E-mu Emulator III / EOS EMU3 filesystem images
//   - Roland S-770 / S-750 / S-760 SCSI/CD images
//   - Roland S-50 / S-550 / S-330 / W-30 floppy images
//   - Ensoniq EPS / ASR-10 GKH / floppy images
//   - Yamaha A3000 / A4000 / A5000 SFS images
//   - Casio FZ-1 1.3 MB floppy dumps
//   - ISO 9660 standard CD-ROM images
// ─────────────────────────────────────────────────────────

import { isAkaiDiskImage } from './AkaiDiskFormat.ts';
import { isEmuDiskImage } from './EmuDiskFormat.ts';
import { isRolandDiskImage } from './RolandDiskFormat.ts';
import { isEnsoniqDiskImage } from './EnsoniqDiskFormat.ts';
import { isYamahaDiskImage } from './YamahaDiskFormat.ts';
import { isMpcDiskImage } from './AkaiMpcClassicFormat.ts';
import { isRolandS5xxDiskImage } from './RolandS5xxFormat.ts';
import { isCasioFzData } from './CasioFzFormat.ts';

export type IdentifiedDiskType =
  | 'akai_s1000'
  | 'akai_s3000'
  | 'akai_s900'
  | 'akai_mpc2000'
  | 'emu_emu3'
  | 'roland_s7xx'
  | 'roland_s5xx'
  | 'ensoniq_eps_asr'
  | 'yamaha_a_series'
  | 'casio_fz'
  | 'iso_9660'
  | 'unknown';

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  if (offset + len > buf.length) len = Math.max(0, buf.length - offset);
  let str = '';
  for (let i = 0; i < len; i++) {
    const c = buf[offset + i];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

function doesOnlyContain(buf: Uint8Array, value: number, len: number): boolean {
  const checkLen = Math.min(len, buf.length);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] !== value) return false;
  }
  return true;
}

/**
 * Robustly inspects an ISO, raw hard disk, or floppy image buffer to determine the format.
 */
export function identifyDiskImageFormat(data: ArrayBuffer | Uint8Array): IdentifiedDiskType {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 512) return 'unknown';

  // 1. E-mu EOS (Emulator IV series) — EMU3 filesystem
  if (readAscii(buf, 0, 4) === 'EMU3') {
    return 'emu_emu3';
  }

  // 2. Akai MPC2000 / MPC2000XL floppy
  if (isMpcDiskImage(buf)) {
    return 'akai_mpc2000';
  }

  // 3. Casio FZ floppy image (exactly 1,310,720 bytes)
  if (buf.length === 1310720 && isCasioFzData(buf)) {
    return 'casio_fz';
  }

  // 4. Roland S-5xx floppy (737,280 bytes)
  if (isRolandS5xxDiskImage(buf)) {
    return 'roland_s5xx';
  }

  // 5. ISO 9660 marker at 0x8001
  if (buf.length >= 0x8006 && readAscii(buf, 0x8001, 5) === 'CD001') {
    return 'iso_9660';
  }

  // 6. Akai S3000 SCSI / CD (TAGS at 17920)
  if (buf.length >= 17924 && readAscii(buf, 17920, 4) === 'TAGS') {
    return 'akai_s3000';
  }

  // 7. Roland S-7xx marker at offset 5 ("770")
  if (buf.length >= 8 && readAscii(buf, 5, 3) === '770') {
    return 'roland_s7xx';
  }

  // 8. Ensoniq disk fill checks (0x5B or 0x00)
  if (doesOnlyContain(buf, 0x5b, 200) || isEnsoniqDiskImage(buf)) {
    return 'ensoniq_eps_asr';
  }

  // 9. Yamaha A-Series (A3000/A4000/A5000 SFS)
  if (isYamahaDiskImage(buf)) {
    return 'yamaha_a_series';
  }

  // 10. General Akai S-Series (S1000 / S900 / S950)
  if (isAkaiDiskImage(buf)) {
    return 'akai_s1000';
  }

  // 11. Roland S-7xx / S-760 general detector
  if (isRolandDiskImage(buf)) {
    return 'roland_s7xx';
  }

  // 12. E-mu general detector
  if (isEmuDiskImage(buf)) {
    return 'emu_emu3';
  }

  return 'unknown';
}
