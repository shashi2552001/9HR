import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildOtpauthUrl,
  decryptBuffer,
  decryptString,
  encryptBuffer,
  encryptString,
  generateNumericOtp,
  generateRandomToken,
  generateTotpSecret,
  hashPassword,
  sanitizeText,
  sha256,
  signDownloadToken,
  validateFileMagicBytes,
  verifyDownloadToken,
  verifyPassword,
  verifyTotpToken,
} from '../src/server/security.ts';
import { DEFAULT_ROLE_PERMISSIONS, PIPELINE_STAGES } from '../src/server/constants.ts';
import { isSmtpConfigured, isValidSmtpHost, sendEmailNotification } from '../src/server/mailer.ts';

test('AES-256-GCM document buffer encryption and decryption roundtrip', () => {
  const sample = Buffer.from('%PDF-1.7 9HR India Confidential Onboarding Record');
  const { encrypted, ivHex, tagHex } = encryptBuffer(sample);
  assert.notEqual(encrypted.toString('utf8'), sample.toString('utf8'));
  const decrypted = decryptBuffer(encrypted, ivHex, tagHex);
  assert.deepEqual(decrypted, sample);
});

test('Encrypted string helper protects TOTP secrets at rest', () => {
  const secret = generateTotpSecret();
  const sealed = encryptString(secret);
  assert.equal(decryptString(sealed), secret);
});

test('Short-lived signed download token validates and rejects tampering', () => {
  const token = signDownloadToken({ docId: 42, actorType: 'INTERNAL', actorId: 7 }, 120);
  const payload = verifyDownloadToken(token);
  assert.ok(payload);
  assert.equal(payload.docId, 42);
  assert.equal(payload.actorId, 7);

  const tampered = `${token.slice(0, -4)}XXXX`;
  assert.equal(verifyDownloadToken(tampered), null);

  const expired = signDownloadToken({ docId: 42, actorType: 'INTERNAL', actorId: 7 }, -10);
  assert.equal(verifyDownloadToken(expired), null);
});

test('RFC 6238 TOTP generation and verification with Google/Microsoft Authenticator compatibility', () => {
  const secret = generateTotpSecret();
  const uri = buildOtpauthUrl('superadmin@9hrindia.com', secret);
  assert.ok(uri.startsWith('otpauth://totp/'));

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = crypto.createHmac('sha1', Buffer.from(bytes)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = String(
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
      1_000_000,
  ).padStart(6, '0');

  assert.equal(verifyTotpToken(secret, code), true);
  assert.equal(verifyTotpToken(secret, '000000'), code === '000000');
});

test('File upload magic-byte security check rejects spoofed executables', () => {
  const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n');
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const spoofedExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');

  assert.equal(validateFileMagicBytes(validPdf, 'application/pdf'), true);
  assert.equal(validateFileMagicBytes(validPng, 'image/png'), true);
  assert.equal(validateFileMagicBytes(validJpg, 'image/jpeg'), true);
  assert.equal(validateFileMagicBytes(spoofedExe, 'application/pdf'), false);
});

test('Password hashing and verification via bcryptjs', async () => {
  const hash = await hashPassword('Enterprise#9HR2026');
  assert.equal(await verifyPassword('Enterprise#9HR2026', hash), true);
  assert.equal(await verifyPassword('WrongPassword', hash), false);
});

test('XSS sanitization strips dangerous angle brackets and trims input', () => {
  assert.equal(sanitizeText('  <script>alert(1)</script>Rahul  '), 'scriptalert(1)/scriptRahul');
});

test('OTP and cryptographic tokens generate valid formats and SHA-256 digests', () => {
  const otp = generateNumericOtp(6);
  assert.match(otp, /^\d{6}$/);

  const tokens = Array.from({ length: 8 }, () => generateRandomToken(5).toUpperCase());
  assert.equal(new Set(tokens).size, 8);
  assert.equal(sha256(tokens[0]).length, 64);
});

test('RBAC permissions and 15-stage recruitment pipeline enforce strict role isolation', () => {
  assert.equal(PIPELINE_STAGES.length, 15);
  assert.ok(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN.includes('system.settings'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN.includes('roles.manage'));
  assert.equal(DEFAULT_ROLE_PERMISSIONS.ADMIN.includes('system.settings'), false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.ADMIN.includes('roles.manage'), false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.RECRUITER.includes('candidates.view_all'), false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.RECRUITER.includes('documents.verify'), false);
});

test('Mailer rejects placeholder SMTP hosts like temp and falls back cleanly to LOG_ONLY', async () => {
  assert.equal(isValidSmtpHost('temp'), false);
  assert.equal(isValidSmtpHost('smtp.example.com'), false);
  assert.equal(isValidSmtpHost('smtp.gmail.com'), true);

  const prevHost = process.env.SMTP_HOST;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;
  try {
    process.env.SMTP_HOST = 'temp';
    process.env.SMTP_USER = 'temp';
    process.env.SMTP_PASS = 'temp';
    assert.equal(isSmtpConfigured(), false);
    const res = await sendEmailNotification({
      to: 'itsdemoid00@gmail.com',
      subject: 'Test',
      text: 'Test message',
    });
    assert.equal(res.delivered, false);
    assert.equal(res.mode, 'LOG_ONLY');
  } finally {
    if (prevHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = prevHost;
    if (prevUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = prevUser;
    if (prevPass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = prevPass;
  }
});

