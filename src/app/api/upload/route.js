import { auth } from '@/lib/auth';
import crypto from 'crypto';

import { AUDIO_MAX_SIZE, IMAGE_MAX_SIZE, audioFormat, imageFormat, uploadForm } from '@/lib/upload-files';

// Local dev fallback
async function saveLocal(buffer, filename, audio = false) {
  const { writeFile, mkdir } = await import('fs/promises');
  const path = await import('path');
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);
  return audio ? `/api/uploads/${filename}` : `/uploads/${filename}`;
}

// Production: Google Cloud Storage
async function saveToGCS(buffer, filename, contentType) {
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
  const blob = bucket.file(filename);
  await blob.save(buffer, {
    metadata: { contentType },
  });
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${filename}`;
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = request.headers.get('origin');
  const expected = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  if (origin && origin !== new URL(expected).origin) {
    return Response.json({ error: 'Invalid origin' }, { status: 403 });
  }
  try {
    const formData = await uploadForm(request);
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !file.size) {
      return Response.json({ error: 'Choose a non-empty file' }, { status: 400 });
    }
    const audio = formData.get('kind') === 'audio';
    if (file.size > (audio ? AUDIO_MAX_SIZE : IMAGE_MAX_SIZE)) {
      return Response.json({ error: audio ? 'Audio files must be 20 MB or smaller' : 'Images must be 5 MB or smaller' }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const format = audio ? audioFormat(buffer) : imageFormat(file.type);
    if (!format) {
      return Response.json({ error: audio ? 'Choose an MP3, M4A, WAV, OGG, WebM, FLAC or AAC audio file' : 'Only JPEG, PNG, GIF and WebP images are supported' }, { status: 400 });
    }
    const filename = `${crypto.randomUUID()}.${format.ext}`;
    const url = process.env.GCS_BUCKET_NAME
      ? await saveToGCS(buffer, filename, format.type)
      : await saveLocal(buffer, filename, audio);
    return Response.json({ url, type: format.type, name: file.name.slice(0, 255) });
  } catch (error) {
    const tooLarge = error.message?.startsWith('File too large');
    return Response.json({ error: tooLarge ? error.message : 'Upload failed. Please try again.' }, { status: tooLarge ? 413 : 500 });
  }
}
