"""
Pure Python and pure TypeScript implementation of REX2 / DWOP audio decompressor.
References clean-room specifications from chirashi (MIT) and Paketti (MIT).
"""
import struct
import io
import wave
from array import array
from typing import List, Tuple, Optional, Dict, Any

MAX_RX2_FRAMES = 50_000_000       # ~18 min @ 44.1 kHz
MAX_RX2_CHANNELS = 2
MAX_IFF_DEPTH = 8
MAX_WAV_OUT_BYTES = 200 * 1024 * 1024

class BitReader:
    def __init__(self, data: bytes):
        words = len(data) // 4
        # Unpack as big-endian uint32 words
        self.data = list(struct.unpack(f'>{words}I', data[:words * 4]))
        self.pos = 0
        self.current = 0
        self.bits_left = 0
        self.eof = False

    def read_bit(self) -> bool:
        self.bits_left -= 1
        if self.bits_left < 0:
            if self.pos >= len(self.data):
                self.eof = True
                return False
            self.current = self.data[self.pos]
            self.pos += 1
            self.bits_left = 31

        bit = bool(self.current & 0x80000000)
        self.current = (self.current << 1) & 0xFFFFFFFF
        return bit

    def read_bits(self, n: int) -> int:
        if n <= 0 or n > 31:
            self.eof = True
            return 0
        result = (self.current >> (32 - n)) & 0xFFFFFFFF
        self.current = (self.current << n) & 0xFFFFFFFF
        bl_before = self.bits_left
        self.bits_left -= n
        if bl_before - n < 0:
            if self.pos >= len(self.data):
                self.eof = True
                return result
            next_word = self.data[self.pos]
            self.pos += 1
            self.bits_left += 32
            result |= (next_word >> self.bits_left) & 0xFFFFFFFF
            self.current = (next_word << (32 - self.bits_left)) & 0xFFFFFFFF
        return result

def _mag(v: int) -> int:
    # mag(v) = uint32(v ^ (v >> 31))
    v32 = v & 0xFFFFFFFF
    sign = (v >> 31) & 1
    if sign:
        return (~v32) & 0xFFFFFFFF
    return v32

def _to_int32(x: int) -> int:
    x &= 0xFFFFFFFF
    if x >= 0x80000000:
        return x - 0x100000000
    return x

def _apply_predictor(idx: int, s2x: int, deltas: List[int]) -> int:
    d0, d1, d2, d3, d4 = deltas
    if idx == 0:
        t0 = _to_int32(s2x - d0)
        t1 = _to_int32(t0 - d1)
        t2 = _to_int32(t1 - d2)
        deltas[4] = _to_int32(t2 - d3)
        deltas[3] = t2
        deltas[2] = t1
        deltas[1] = t0
        deltas[0] = s2x
        return s2x
    elif idx == 1:
        t1 = _to_int32(s2x - d1)
        t2 = _to_int32(t1 - d2)
        nd0 = _to_int32(d0 + s2x)
        deltas[4] = _to_int32(t2 - d3)
        deltas[3] = t2
        deltas[2] = t1
        deltas[1] = s2x
        deltas[0] = nd0
        return nd0
    elif idx == 2:
        nd1 = _to_int32(d1 + s2x)
        nd0 = _to_int32(d0 + nd1)
        t = _to_int32(s2x - d2)
        deltas[4] = _to_int32(t - d3)
        deltas[3] = t
        deltas[2] = s2x
        deltas[1] = nd1
        deltas[0] = nd0
        return nd0
    elif idx == 3:
        nd2 = _to_int32(d2 + s2x)
        nd1 = _to_int32(d1 + nd2)
        nd0 = _to_int32(d0 + nd1)
        deltas[4] = _to_int32(s2x - d3)
        deltas[3] = s2x
        deltas[2] = nd2
        deltas[1] = nd1
        deltas[0] = nd0
        return nd0
    elif idx == 4:
        nd3 = _to_int32(d3 + s2x)
        nd2 = _to_int32(d2 + nd3)
        nd1 = _to_int32(d1 + nd2)
        nd0 = _to_int32(d0 + nd1)
        deltas[4] = s2x
        deltas[3] = nd3
        deltas[2] = nd2
        deltas[1] = nd1
        deltas[0] = nd0
        return nd0
    return d0

def _update_averages(averages: List[int], deltas: List[int]):
    for i in range(5):
        averages[i] = (averages[i] + _mag(deltas[i]) - (averages[i] >> 5)) & 0xFFFFFFFF

class DwopDecompressor:
    def __init__(self, data: bytes):
        self.br = BitReader(data)
        self.deltas = [[0]*5, [0]*5]
        self.averages = [[2560]*5, [2560]*5]
        self.j = [2, 2]
        self.rbits = [0, 0]

    def _adjust_j_rbits(self, c: int, step: int):
        j_val = self.j[c]
        rbits_val = self.rbits[c]
        if step < j_val:
            jt = j_val >> 1
            while step < jt:
                j_val = jt
                rbits_val -= 1
                jt >>= 1
        else:
            while step >= j_val:
                prev = j_val
                j_val = (j_val << 1) & 0xFFFFFFFF
                rbits_val += 1
                if j_val <= prev:
                    j_val = prev
                    break
        self.j[c] = j_val
        self.rbits[c] = rbits_val

    def decode_frame(self, c: int) -> Tuple[int, bool]:
        avg = self.averages[c]
        min_avg = avg[0]
        min_idx = 0
        for i in range(1, 5):
            if avg[i] < min_avg:
                min_avg = avg[i]
                min_idx = i

        step = ((min_avg * 3) + 36) >> 7
        prefix_sum = 0
        zeros_win = 7

        while True:
            bit = self.br.read_bit()
            if self.br.eof:
                return 0, False
            if bit:
                break
            if step > 0 and prefix_sum > 0xFFFFFFFF - step:
                self.br.eof = True
                return 0, False
            prefix_sum = (prefix_sum + step) & 0xFFFFFFFF
            zeros_win -= 1
            if zeros_win == 0:
                step = (step << 2) & 0xFFFFFFFF
                zeros_win = 7

        if self.br.eof:
            return 0, False

        self._adjust_j_rbits(c, step)

        rem = 0
        if self.rbits[c] > 0:
            rem = self.br.read_bits(self.rbits[c])
            if self.br.eof:
                return 0, False

        thresh = self.j[c] - step
        if rem >= thresh:
            extra = self.br.read_bits(1)
            if self.br.eof:
                return 0, False
            rem = (rem * 2 - thresh + extra) & 0xFFFFFFFF

        code_val = (rem + prefix_sum) & 0xFFFFFFFF
        signed2x = _to_int32((-(code_val & 1)) ^ code_val)
        s2x = _apply_predictor(min_idx, signed2x, self.deltas[c])
        _update_averages(self.averages[c], self.deltas[c])
        return s2x, True

def clamp_sample(v: int, bit_depth: int) -> int:
    if bit_depth == 16:
        max_s, min_s = 32767, -32768
    elif bit_depth == 24:
        max_s, min_s = 8388607, -8388608
    else:
        max_s, min_s = 32767, -32768
    if v > max_s: return max_s
    if v < min_s: return min_s
    return v

def decompress_rx2(data: bytes) -> Dict[str, Any]:
    if len(data) < 12 or data[0:4] != b'CAT ' or data[8:12] != b'REX2':
        raise ValueError("Invalid REX2 file header")

    info = {
        'channels': 1,
        'sample_rate': 44100,
        'bit_depth': 16,
        'total_frames': 0,
        'loop_start': 0,
        'loop_end': 0,
        'slices': []
    }

    dwop_offset = 0
    dwop_size = 0

    def parse_iff(start: int, end: int, depth: int = 0):
        nonlocal dwop_offset, dwop_size
        if depth > MAX_IFF_DEPTH:
            raise ValueError('REX2 IFF nesting too deep')
        off = start
        while off + 8 <= end and off + 8 <= len(data):
            chunk_id = data[off:off+4]
            chunk_sz = struct.unpack('>I', data[off+4:off+8])[0]
            off += 8
            if off + chunk_sz > len(data):
                break
            chunk_data = data[off:off+chunk_sz]

            if chunk_id == b'SINF' and len(chunk_data) >= 18:
                info['channels'] = int(chunk_data[0]) if chunk_data[0] in (1, 2) else 1
                bd_code = chunk_data[1]
                info['bit_depth'] = 24 if bd_code == 5 else (8 if bd_code == 1 else 16)
                info['sample_rate'] = struct.unpack('>I', chunk_data[2:6])[0]
                info['total_frames'] = struct.unpack('>I', chunk_data[6:10])[0]
                info['loop_start'] = struct.unpack('>I', chunk_data[10:14])[0]
                info['loop_end'] = struct.unpack('>I', chunk_data[14:18])[0]
            elif chunk_id == b'SLCE' and len(chunk_data) >= 8:
                s_start = struct.unpack('>I', chunk_data[0:4])[0]
                s_len = struct.unpack('>I', chunk_data[4:8])[0]
                flags = chunk_data[10] if len(chunk_data) > 10 else 0
                if not (flags & 0x01): # not muted
                    info['slices'].append({'start': s_start, 'length': s_len, 'flags': flags})
            elif chunk_id in (b'SDAT', b'DWOP'):
                if dwop_size == 0:
                    dwop_offset = off
                    dwop_size = chunk_sz
            elif chunk_id == b'CAT ' and chunk_sz >= 4:
                parse_iff(off + 4, off + chunk_sz, depth + 1)

            off += chunk_sz
            if off & 1:
                off += 1

    parse_iff(12, len(data), 0)

    if dwop_size == 0 or info['total_frames'] == 0:
        raise ValueError("No DWOP/SDAT audio chunk or 0 frames found in REX2")

    channels = info['channels']
    bit_depth = info['bit_depth']
    sample_rate = info['sample_rate']
    total_frames = info['total_frames']

    if not (1 <= channels <= MAX_RX2_CHANNELS):
        raise ValueError(f"Invalid channels in REX2: {channels}")
    if not (8000 <= sample_rate <= 192000):
        raise ValueError(f"Invalid sample rate in REX2: {sample_rate}")
    if not (0 < total_frames <= MAX_RX2_FRAMES):
        raise ValueError(f"Invalid total frames in REX2: {total_frames}")
    bytes_per_sample = bit_depth // 8
    if total_frames * channels * bytes_per_sample > MAX_WAV_OUT_BYTES:
        raise ValueError(f"Decompressed audio exceeds maximum output size ({MAX_WAV_OUT_BYTES} bytes)")

    dec = DwopDecompressor(data[dwop_offset:dwop_offset+dwop_size])

    if bit_depth == 16:
        pcm_samples = array('h')
    else:
        pcm_samples = []

    if channels == 1:
        for _ in range(total_frames):
            s2x, ok = dec.decode_frame(0)
            if not ok: break
            pcm_samples.append(clamp_sample(s2x >> 1, bit_depth))
    else:
        for _ in range(total_frames):
            s2x_l, ok_l = dec.decode_frame(0)
            if not ok_l: break
            s2x_r, ok_r = dec.decode_frame(1)
            if not ok_r: break
            left = clamp_sample(s2x_l >> 1, bit_depth)
            right = clamp_sample((s2x_l + s2x_r) >> 1, bit_depth)
            pcm_samples.append(left)
            pcm_samples.append(right)

    # Encode to standard WAV PCM buffer
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(bit_depth // 8)
        wav_file.setframerate(info['sample_rate'])
        if bit_depth == 16:
            packed_frames = pcm_samples.tobytes()
        else: # 24-bit
            # Pack 3-byte integers
            b_list = bytearray()
            for s in pcm_samples:
                b = s.to_bytes(3, byteorder='little', signed=True)
                b_list.extend(b)
            packed_frames = bytes(b_list)
        wav_file.writeframes(packed_frames)

    return {
        'info': info,
        'wav_bytes': wav_io.getvalue(),
        'decoded_frames': len(pcm_samples) // channels
    }

if __name__ == '__main__':
    rx2_path = 'D:/desarrollos/ABDSynths/_RESOURCES/rex recycle/Autodafe-Casio-VL-1-Loops/4-beat.rx2'
    with open(rx2_path, 'rb') as f:
        rx2_bytes = f.read()
    res = decompress_rx2(rx2_bytes)
    print("Decoded OK!")
    print("Channels:", res['info']['channels'], "SR:", res['info']['sample_rate'], "BD:", res['info']['bit_depth'])
    print("Total frames expected:", res['info']['total_frames'], "Decoded:", res['decoded_frames'])
    print("WAV size:", len(res['wav_bytes']), "bytes")
    print("Slices:", len(res['info']['slices']), res['info']['slices'])
