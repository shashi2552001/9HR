import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const getSecretKey = (envVarName: string, purpose: string): Buffer => {
  const raw = process.env[envVarName] || process.env.SESSION_SECRET || '9hr-india-dev-fallback-key-change-in-prod';
  return crypto.createHash('sha256').update(`${purpose}:${raw}`).digest();
};

export const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export const generateRandomToken = (bytes = 32): string =>
  crypto.randomBytes(bytes).toString('hex');

export const generateNumericOtp = (digits = 6): string => {
  const max = 10 ** digits;
  const min = 10 ** (digits - 1);
  return String(crypto.randomInt(min, max));
};

export const hashPassword = async (password: string): Promise<string> =>
  bcrypt.hash(password, 12);

export const verifyPassword = async (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);

// AES-256-GCM encryption for candidate documents at rest
export const encryptBuffer = (plain: Buffer): { encrypted: Buffer; ivHex: string; tagHex: string } => {
  const key = getSecretKey('FILE_ENCRYPTION_KEY', 'aes-256-gcm-file');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    ivHex: iv.toString('hex'),
    tagHex: tag.toString('hex'),
  };
};

export const decryptBuffer = (encrypted: Buffer, ivHex: string, tagHex: string): Buffer => {
  const key = getSecretKey('FILE_ENCRYPTION_KEY', 'aes-256-gcm-file');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

export const encryptString = (plainText: string): string => {
  const { encrypted, ivHex, tagHex } = encryptBuffer(Buffer.from(plainText, 'utf8'));
  return `${ivHex}:${tagHex}:${encrypted.toString('hex')}`;
};

export const decryptString = (payload: string): string => {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid encrypted payload format');
  }
  return decryptBuffer(Buffer.from(dataHex, 'hex'), ivHex, tagHex).toString('utf8');
};

// Short-lived HMAC-signed download token (prevents public URL exposure)
export interface DownloadTokenPayload {
  docId: number;
  actorType: 'INTERNAL' | 'CANDIDATE';
  actorId: number;
  exp: number;
}

export const signDownloadToken = (payload: Omit<DownloadTokenPayload, 'exp'>, ttlSeconds = 120): string => {
  const fullPayload: DownloadTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const secret = getSecretKey('DOWNLOAD_TOKEN_SECRET', 'download-hmac');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
};

export const verifyDownloadToken = (token: string): DownloadTokenPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const secret = getSecretKey('DOWNLOAD_TOKEN_SECRET', 'download-hmac');
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DownloadTokenPayload;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
};

// RFC 4648 Base32 + RFC 6238 TOTP (Google / Microsoft Authenticator compatible)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const generateTotpSecret = (bytes = 20): string => {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};

const base32ToBuffer = (base32: string): Buffer => {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const computeHotp = (secretBase32: string, counter: number): string => {
  const key = base32ToBuffer(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
};

export const verifyTotpToken = (secretBase32: string, token: string, windowSteps = 1): boolean => {
  const sanitized = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(sanitized)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = computeHotp(secretBase32, currentCounter + delta);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(sanitized))) {
      return true;
    }
  }
  return false;
};

export const buildOtpauthUrl = (email: string, secretBase32: string): string => {
  const issuer = encodeURIComponent('9HR India Portal');
  const label = encodeURIComponent(`9HR India:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
};

// Magic-byte verification for uploaded documents (PDF, JPG, PNG)
export const validateFileMagicBytes = (buffer: Buffer, claimedMime: string): boolean => {
  if (buffer.length < 8) return false;
  if (claimedMime === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (claimedMime === 'image/jpeg' || claimedMime === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (claimedMime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  return false;
};

export const sanitizeText = (input: string): string =>
  input.replace(/[<>]/g, '').trim();
