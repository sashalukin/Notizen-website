export const AUDIO_MAX_SIZE = 20 * 1024 * 1024;
export const IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const images = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

// Inspect file signatures rather than trusting the extension or browser MIME label.
// Container formats can hold different codecs; decoding support belongs to the browser.
export function audioFormat(bytes) {
  const text = (start, end) => bytes.subarray(start, end).toString('ascii');
  if (bytes.length < 12) return null;
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return { type: 'audio/wav', ext: 'wav' };
  if (text(0, 4) === 'fLaC') return { type: 'audio/flac', ext: 'flac' };
  if (text(0, 4) === 'OggS') return { type: 'audio/ogg', ext: 'ogg' };
  if (text(4, 8) === 'ftyp') return { type: 'audio/mp4', ext: 'm4a' };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { type: 'audio/webm', ext: 'webm' };
  if (text(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0)) return { type: 'audio/mpeg', ext: 'mp3' };
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { type: 'audio/aac', ext: 'aac' };
  return null;
}
export function imageFormat(type) { return images[type] ? { type, ext: images[type] } : null; }

// Bound multipart parsing too, including requests without Content-Length.
export async function uploadForm(request) {
  const limit = AUDIO_MAX_SIZE + 1024 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new Error('No file provided');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error('File too large (audio max 20 MB; images max 5 MB)'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  return new Request(request.url, { method: 'POST', headers: request.headers, body }).formData();
}
