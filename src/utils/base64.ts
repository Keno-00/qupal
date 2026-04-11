const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_REVERSE: Record<string, number> = Object.fromEntries(
  BASE64_ALPHABET.split('').map((ch, idx) => [ch, idx]),
);

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error('Invalid base64 length.');
  }

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outputLength = (clean.length / 4) * 3 - padding;
  const output = new Uint8Array(outputLength);

  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean[i];
    const c1 = clean[i + 1];
    const c2 = clean[i + 2];
    const c3 = clean[i + 3];

    const n0 = BASE64_REVERSE[c0] ?? 0;
    const n1 = BASE64_REVERSE[c1] ?? 0;
    const n2 = c2 === '=' ? 0 : BASE64_REVERSE[c2] ?? 0;
    const n3 = c3 === '=' ? 0 : BASE64_REVERSE[c3] ?? 0;

    const chunk = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3;

    output[outIndex++] = (chunk >> 16) & 0xff;
    if (c2 !== '=' && outIndex < output.length + 1) {
      output[outIndex++] = (chunk >> 8) & 0xff;
    }
    if (c3 !== '=' && outIndex < output.length + 1) {
      output[outIndex++] = chunk & 0xff;
    }
  }

  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    const chunk = (b0 << 16) | (b1 << 8) | b2;

    const c0 = BASE64_ALPHABET[(chunk >> 18) & 0x3f];
    const c1 = BASE64_ALPHABET[(chunk >> 12) & 0x3f];
    const c2 = i + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 0x3f] : '=';
    const c3 = i + 2 < bytes.length ? BASE64_ALPHABET[chunk & 0x3f] : '=';

    output += c0 + c1 + c2 + c3;
  }
  return output;
}