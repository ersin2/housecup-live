const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 128-bit random token → 22 base64url chars. */
export function randomToken(bytes = 16): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Uniform random 4-digit PIN (rejection sampling, no modulo bias). */
export function randomPin(): string {
  const buf = new Uint16Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < 60000) return String(v % 10000).padStart(4, '0');
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (hash first so lengths never leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return base64url(new Uint8Array(sig));
}

export async function hmacVerify(secret: string, data: string, sig: string): Promise<boolean> {
  let raw: Uint8Array;
  try {
    raw = fromBase64url(sig);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), raw, enc.encode(data));
}
