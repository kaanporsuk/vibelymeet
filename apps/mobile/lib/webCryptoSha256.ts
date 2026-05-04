import { sha256 } from '@noble/hashes/sha2.js';

type DigestAlgorithm = string | { name?: string };
type DigestInput = ArrayBuffer | ArrayBufferView;
type MinimalSubtleCrypto = {
  digest: (algorithm: DigestAlgorithm, data: DigestInput) => Promise<ArrayBuffer>;
};
type CryptoLike = {
  subtle?: Partial<MinimalSubtleCrypto>;
};

function normalizeDigestAlgorithm(algorithm: DigestAlgorithm): string {
  return (typeof algorithm === 'string' ? algorithm : algorithm.name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function inputToBytes(data: DigestInput): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

export function digestSha256ForPkce(data: DigestInput): ArrayBuffer {
  const digest = sha256(inputToBytes(data));
  return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
}

async function digest(algorithm: DigestAlgorithm, data: DigestInput): Promise<ArrayBuffer> {
  if (normalizeDigestAlgorithm(algorithm) !== 'sha256') {
    throw new TypeError('Only SHA-256 digest is supported by the Vibely native WebCrypto shim.');
  }
  return digestSha256ForPkce(data);
}

export function installNativeSha256SubtleCrypto(): void {
  const globalCrypto = (globalThis as { crypto?: CryptoLike }).crypto ?? {};
  if (typeof globalCrypto.subtle?.digest === 'function') return;

  const subtle: MinimalSubtleCrypto = { digest };
  Object.defineProperty(globalCrypto, 'subtle', {
    configurable: true,
    enumerable: true,
    value: subtle,
  });

  if (!(globalThis as { crypto?: CryptoLike }).crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: globalCrypto,
    });
  }
}

installNativeSha256SubtleCrypto();
