// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Byte helpers for sampler format parsers
//
// `Uint8Array#buffer` is typed `ArrayBufferLike` (it may be a
// SharedArrayBuffer), while every binary parser entry point
// expects a plain `ArrayBuffer`. This helper performs the copy
// explicitly so the narrowing is real, not a cast.
// ─────────────────────────────────────────────────────────

/** Copies a byte view into a fresh, exactly-sized `ArrayBuffer`. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
