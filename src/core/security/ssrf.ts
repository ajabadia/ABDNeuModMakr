// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SSRF hostname classifier (S4.1)
// Shared by `validateAiBridgeEndpoint` (sessionSchema) y `validateBridgeUrl`
// (bridgeTypes). Cubre los bypasses por IPv6 que los checks ingenuos de
// rangos IPv4 no ven: `::ffff:<ipv4>` (IPv4-mapeado), `fe80::/10`
// (link-local), `fc00::/7` (ULA) y `::` (all-zeros ≈ 0.0.0.0).
// Node (WHATWG URL) normaliza `2130706433`/`0x7f.0.0.1`/`0177.0.0.1` a
// `127.0.0.1`, así que esos ya caen en los checks IPv4; aquí solo se añade
// lo que el parser deja en forma IPv6 (con corchetes en `.hostname`).
// ─────────────────────────────────────────────────────────

/** Loopback explícito permitido (puente local del propio usuario). */
export function isLoopbackHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

/** Rangos IPv4 privados/link-local/reservados (mismo criterio S4.1). */
export function isBlockedIPv4Host(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h === '169.254.169.254' || h.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * Convierte la cola de un `::ffff:<cola>` a IPv4 punteada.
 * Acepta `10.0.0.1` o dos grupos hex (`a00:1`); resto → null (fail-closed).
 */
function mappedTailToIPv4(tail: string): string | null {
  const t = tail.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return t;
  const groups = t.split(':');
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0], 16);
  const lo = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
    return null;
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * `true` = el host debe bloquearse (no loopback y no público global).
 * `false` = loopback (permitido) o público (lo filtra la allowlist de cada caso).
 */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (isLoopbackHostname(h)) return false;
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1);
    if (inner === '' || inner === '::' || inner === '::0') return true;
    const mapped = inner.match(/^::ffff:(.+)$/);
    if (mapped) {
      const v4 = mappedTailToIPv4(mapped[1]);
      if (v4 === null) return true;
      if (v4.startsWith('127.')) return false;
      return isBlockedIPv4Host(v4) ? true : true; // mapeado nunca es público global: fail-closed
    }
    if (inner === '::1') return false;
    if (/^fe[89ab][0-9a-f]{0,3}:/.test(inner)) return true; // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{0,3}:/.test(inner)) return true; // fc00::/7 ULA
    return false; // unicast global pública
  }
  return isBlockedIPv4Host(h);
}

export function assertSafeExternalHttpsUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid external URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error(`Only HTTPS is allowed, got ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new Error('Credentials in external URL are forbidden');
  }
  if (isLoopbackHostname(u.hostname) || isBlockedHostname(u.hostname)) {
    throw new Error(`Blocked unsafe external URL host: ${u.hostname}`);
  }
  return u.toString();
}

export function assertSafeLoopbackHttpUrl(rawUrl: string, allowedPorts = [11434, 1234, 8080, 8000]): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid loopback URL');
  }
  if (u.protocol !== 'http:') {
    throw new Error(`Only HTTP is allowed for local loopback, got ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new Error('Credentials in loopback URL are forbidden');
  }
  const host = u.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
    throw new Error(`Host must be loopback (127.0.0.1 or localhost), got: ${u.hostname}`);
  }
  const port = u.port ? Number.parseInt(u.port, 10) : 80;
  if (!allowedPorts.includes(port)) {
    throw new Error(`Port ${port} is not in allowed loopback ports: ${allowedPorts.join(', ')}`);
  }
  return u.origin;
}
