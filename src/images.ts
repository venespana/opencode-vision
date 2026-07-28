import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { SavedImage } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Supported MIME types
// ─────────────────────────────────────────────────────────────────────────────
const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ─────────────────────────────────────────────────────────────────────────────
// isSupportedImageFilePart — returns true if part is a supported image FilePart
// part is a raw FilePart from the chat messages (before conversion to SavedImage)
// ─────────────────────────────────────────────────────────────────────────────
export function isSupportedImageFilePart(
  part: { type: string; mime?: string; url?: string },
): part is { type: 'file'; mime: 'image/png' | 'image/jpeg' | 'image/webp'; url: string } {
  return part.type === 'file' && SUPPORTED_MIMES.has(part.mime ?? '');
}

// ─────────────────────────────────────────────────────────────────────────────
// contentHash — sha256 hex of decoded bytes (for stable base64 filenames)
// ─────────────────────────────────────────────────────────────────────────────
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// extractImages — converts FileParts to SavedImages, for base64 origin the url IS the data URL
// ─────────────────────────────────────────────────────────────────────────────
export function extractImages(parts: any[]): SavedImage[] {
  return parts
    .filter(isSupportedImageFilePart)
    .map((part) => {
      const url = part.url ?? '';
      if (url.startsWith('data:')) {
        return {
          partId: part.id,
          mime: part.mime as SavedImage['mime'],
          ref: '',
          origin: { kind: 'base64' as const, path: url },
        };
      }
      if (url.startsWith('file://')) {
        const filePath = fileURLToPath(url);
        return {
          partId: part.id,
          mime: part.mime as SavedImage['mime'],
          ref: filePath,
          origin: { kind: 'file' as const, path: filePath },
        };
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return {
          partId: part.id,
          mime: part.mime as SavedImage['mime'],
          ref: url,
          origin: { kind: 'url' as const, url },
        };
      }
      // Fallback
      return {
        partId: part.id,
        mime: part.mime as SavedImage['mime'],
        ref: url,
        origin: { kind: 'url' as const, url },
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// materialize — write base64 image to temp file; for already-materialized images
// (ref is already set), return immediately (idempotent).
// ─────────────────────────────────────────────────────────────────────────────
export async function materialize(
  image: SavedImage,
  tempDir: string,
): Promise<SavedImage> {
  const { partId, mime, origin } = image;

  if (origin.kind === 'base64') {
    // Already materialized (ref already set to file path)
    if (image.ref) return image;

    // Parse data URL from origin.path
    const dataUrl = origin.path;
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return image;

    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    const hash = contentHash(buffer);
    const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
    const filename = `vision-${hash}.${ext}`;
    const filePath = join(tempDir, filename);

    mkdirSync(dirname(filePath), { recursive: true });

    // Idempotency: reuse if file already exists (same content → same hash)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, buffer);
    }

    return { partId, mime: mimeType as SavedImage['mime'], ref: filePath, origin: { kind: 'base64', path: filePath } };
  }

  if (origin.kind === 'file') {
    const resolved = fileURLToPath(`file://${origin.path}`);
    return { partId, mime, ref: resolved, origin };
  }

  if (origin.kind === 'url') {
    return { partId, mime, ref: origin.url, origin };
  }

  return image;
}
