export const imageLimit = 5 * 1024 * 1024;
export function validateImage(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > imageLimit)
    throw new Error('Choose an image up to 5 MB.');
  const valid =
    (mime === 'image/png' &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
    (mime === 'image/webp' &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!valid) throw new Error('Choose a PNG, JPEG, or WebP image.');
}
