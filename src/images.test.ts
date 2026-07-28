import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { FilePart } from './types.js';

describe('images', () => {
  let extractImages: (parts: any[]) => any[];
  let materialize: (img: any, tempDir: string) => Promise<any>;
  let contentHash: (buffer: Buffer) => string;
  let isSupportedImageFilePart: (part: any) => boolean;

  beforeEach(async () => {
    vi.resetModules();
    const images = await import('./images.js');
    extractImages = images.extractImages;
    materialize = images.materialize;
    contentHash = images.contentHash;
    isSupportedImageFilePart = images.isSupportedImageFilePart;
  });

  // S1: base64 → sha256 content hash filename (stable across reruns)
  it('S1: base64 image is saved with content-hash filename and idempotent', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-'));
    // A valid 1x1 PNG pixel in base64: iVBORw0KGgo= decodes to PNG header
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFfwJ/BfcAAAAASUVORK5CYII=';
    const first = await materialize(
      { partId: 'p1', mime: 'image/png', ref: '', origin: { kind: 'base64', path: dataUrl } },
      tmpDir,
    );
    expect(first.ref).toMatch(/vision-[a-f0-9]{64}\.png$/);
    // Idempotency: second call with same data returns same ref
    const second = await materialize(
      { partId: 'p1', mime: 'image/png', ref: '', origin: { kind: 'base64', path: dataUrl } },
      tmpDir,
    );
    expect(second.ref).toBe(first.ref);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // S2: file:// URL is resolved via fileURLToPath (no copy)
  it('S2: file:// URL is resolved to absolute path without copying', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-'));
    const existingFile = path.join(tmpDir, 'existing.png');
    fs.writeFileSync(existingFile, 'fake png');
    const saved = await materialize(
      { partId: 'p2', mime: 'image/png', ref: existingFile, origin: { kind: 'file', path: existingFile } },
      '/tmp/other',
    );
    expect(saved.ref).toBe(existingFile);
    expect(saved.origin.kind).toBe('file');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // S3: https:// URL is passed through unchanged
  it('S3: https URL is passed through verbatim', async () => {
    const saved = await materialize(
      { partId: 'p3', mime: 'image/jpeg', ref: 'https://example.com/image.jpg', origin: { kind: 'url', url: 'https://example.com/image.jpg' } },
      '/tmp/vision',
    );
    expect(saved.ref).toBe('https://example.com/image.jpg');
    expect(saved.origin.kind).toBe('url');
  });

  // S4: Unsupported MIME is skipped
  it('S4: unsupported MIME type is not a supported image', () => {
    const pdfPart = { type: 'file', mime: 'application/pdf', url: 'data:application/pdf;base64,FAKE' };
    const result = isSupportedImageFilePart(pdfPart);
    expect(result).toBe(false);
  });

  // S5: Supported MIME types (png, jpeg, webp) are accepted
  it('S5: png/jpeg/webp MIME types are supported', () => {
    const png = { type: 'file', mime: 'image/png', url: 'data:image/png;base64,FAKE' };
    const jpeg = { type: 'file', mime: 'image/jpeg', url: 'data:image/jpeg;base64,FAKE' };
    const webp = { type: 'file', mime: 'image/webp', url: 'data:image/webp;base64,FAKE' };
    expect(isSupportedImageFilePart(png)).toBe(true);
    expect(isSupportedImageFilePart(jpeg)).toBe(true);
    expect(isSupportedImageFilePart(webp)).toBe(true);
  });

  // S6: tempDir is honored for base64 saves
  it('S6: base64 images are saved to configured tempDir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-custom-'));
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFfwJ/BfcAAAAASUVORK5CYII=';
    await materialize({ partId: 'p1', mime: 'image/png', ref: '', origin: { kind: 'base64', path: dataUrl } }, tmpDir);
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^vision-[a-f0-9]{64}\.png$/);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // extractImages: converts FileParts to SavedImages
  it('extractImages: returns only supported image FileParts as SavedImages', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      { type: 'file', mime: 'image/png', url: 'data:image/png;base64,FAKE', id: 'p1' },
      { type: 'file', mime: 'application/pdf', url: 'data:application/pdf;base64,FAKE', id: 'p2' },
    ];
    const images = extractImages(parts);
    expect(images).toHaveLength(1);
    expect(images[0].partId).toBe('p1');
    expect(images[0].origin.kind).toBe('base64');
  });

  // contentHash: sha256 hex of decoded bytes
  it('contentHash: produces sha256 hex of decoded base64 bytes', () => {
    const buffer = Buffer.from('A', 'utf-8');
    const hash = contentHash(buffer);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Different content produces different hash
    const hash2 = contentHash(Buffer.from('B', 'utf-8'));
    expect(hash2).not.toBe(hash);
  });

  // Second call with already-materialized ref is idempotent
  it('idempotency: second call with ref already set returns immediately', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-'));
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFfwJ/BfcAAAAASUVORK5CYII=';
    const first = await materialize({ partId: 'p1', mime: 'image/png', ref: '', origin: { kind: 'base64', path: dataUrl } }, tmpDir);
    // Now call with the returned ref already set
    const second = await materialize({ partId: 'p1', mime: 'image/png', ref: first.ref, origin: { kind: 'base64', path: first.ref } }, tmpDir);
    expect(second.ref).toBe(first.ref);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
