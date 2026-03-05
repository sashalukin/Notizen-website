import { auth } from '@/lib/auth';
import crypto from 'crypto';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Local dev fallback
async function saveLocal(buffer, filename) {
  const { writeFile, mkdir } = await import('fs/promises');
  const path = await import('path');
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
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

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: 'Only image files are allowed (JPEG, PNG, GIF, WebP)' }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() || 'png';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const url = process.env.GCS_BUCKET_NAME
    ? await saveToGCS(buffer, filename, file.type)
    : await saveLocal(buffer, filename);

  return Response.json({ url });
}
