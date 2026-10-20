import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImage, imageLimit } from '../src/server/image.js';
test('accepts PNG, JPEG, and WebP signatures', () => {
  validateImage(Buffer.from('89504e470d0a1a0a0000', 'hex'), 'image/png');
  validateImage(Buffer.from('ffd8ffe00000', 'hex'), 'image/jpeg');
  validateImage(Buffer.from('RIFF0000WEBP'), 'image/webp');
});
test('rejects oversized, empty, mismatched, and unsupported image bodies', () => {
  assert.throws(
    () => validateImage(Buffer.alloc(imageLimit + 1), 'image/png'),
    /5 MB/,
  );
  assert.throws(() => validateImage(Buffer.alloc(0), 'image/png'), /5 MB/);
  assert.throws(
    () => validateImage(Buffer.from('<svg></svg>'), 'image/svg+xml'),
    /PNG/,
  );
  assert.throws(
    () => validateImage(Buffer.from('ffd8ffe0', 'hex'), 'image/png'),
    /PNG/,
  );
});
