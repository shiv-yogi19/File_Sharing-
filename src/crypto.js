// Web Crypto helpers. Keys never reach the server (shared via URL fragment or the DTLS DataChannel).
const b64 = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const rand = n => crypto.getRandomValues(new Uint8Array(n));
export const genKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
export const exportKey = async k => b64(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
export const importKey = s => crypto.subtle.importKey('raw', unb64(s), 'AES-GCM', false, ['encrypt', 'decrypt']);

export function identityId() {
  const h = [...rand(4)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `FD-${h.slice(0, 4)}-${h.slice(4)}`;
}
export function joinCode() { // unbiased 6 digits
  let v; do { v = crypto.getRandomValues(new Uint32Array(1))[0]; } while (v >= 4294000000);
  return String(v % 1e6).padStart(6, '0');
}
const aad = (fi, ctr) => { const a = new DataView(new ArrayBuffer(8)); a.setUint32(0, fi); a.setUint32(4, ctr); return a.buffer; };
// IV = peerSalt|fileIndex|counter (unique per key); AAD binds order so reorder/replay fails auth.
export async function encryptChunk(key, salt, fi, ctr, buf) {
  const iv = new Uint8Array(12), d = new DataView(iv.buffer);
  d.setUint32(0, salt); d.setUint32(4, fi); d.setUint32(8, ctr);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(fi, ctr) }, key, buf));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out.buffer;
}
export const decryptChunk = (key, buf, fi, ctr) =>
  crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12), additionalData: aad(fi, ctr) }, key, buf.slice(12));
