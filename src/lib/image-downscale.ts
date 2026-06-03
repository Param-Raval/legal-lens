/**
 * Client-side image downscaling.
 *
 * Vercel serverless functions reject any request body larger than 4.5 MB at the
 * platform edge — before our route code runs — with an opaque HTTP 413. A raw
 * phone photo or high-resolution scan easily exceeds that, so a direct image
 * upload to /api/analyze (or /api/translate) that works locally fails in
 * production. Re-encoding oversized images to a bounded JPEG here keeps the
 * upload under the limit. (PDF pages already arrive as server-rendered JPEGs and
 * don't pass through this path.)
 *
 * The cap is deliberately generous on dimensions so OCR legibility is preserved;
 * we only shrink when a file is actually too big, and step quality/size down
 * until it fits.
 */

/**
 * Keep well under Vercel's 4.5 MB hard limit. multipart/form-data adds encoding
 * overhead (~base64 isn't used for File parts, but headers/boundaries and the
 * languageHint field add a little), so we target ~3.8 MB of image bytes.
 */
const TARGET_MAX_BYTES = 3.8 * 1024 * 1024;
/**
 * Files at or below this are left completely untouched (no re-encode), so small,
 * clean scans keep their original fidelity and format.
 */
const SKIP_BELOW_BYTES = 3.5 * 1024 * 1024;
/** Longest-edge cap on the first downscale attempt — high enough for OCR. */
const INITIAL_MAX_DIMENSION = 2600;
/** Quality steps tried in order until the encoded JPEG fits the target. */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55];
/** Dimension caps tried in order alongside the quality steps. */
const DIMENSION_STEPS = [INITIAL_MAX_DIMENSION, 2200, 1800, 1500];

function canUseCanvas(): boolean {
  return (
    typeof document !== 'undefined' && typeof createImageBitmap === 'function'
  );
}

async function decode(file: File): Promise<ImageBitmap> {
  // createImageBitmap decodes off the main thread and handles orientation.
  return await createImageBitmap(file);
}

function encode(
  bitmap: ImageBitmap,
  maxDimension: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height)
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // White matte so transparent PNG regions don't turn black under JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Returns a downscaled JPEG File if `file` is an oversized raster image, or the
 * original File unchanged otherwise. Never throws: if decoding/encoding fails or
 * canvas is unavailable, the original file is returned (the server-side size
 * guard remains the backstop).
 */
export async function downscaleImageForUpload(file: File): Promise<File> {
  if (
    !file.type.startsWith('image/') ||
    // Vector and animated formats: re-encoding to a single JPEG frame would lose
    // information, and they are not the large-photo case this targets.
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    file.size <= SKIP_BELOW_BYTES ||
    !canUseCanvas()
  ) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    return file; // undecodable (e.g. HEIC) — let the server guard handle it
  }

  try {
    for (let i = 0; i < QUALITY_STEPS.length; i++) {
      const blob = await encode(bitmap, DIMENSION_STEPS[i], QUALITY_STEPS[i]);
      if (blob && blob.size <= TARGET_MAX_BYTES) {
        const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], newName, {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        });
      }
    }
    // Couldn't get under target even at the smallest step — return the smallest
    // attempt we produced rather than the (larger) original.
    const last = await encode(
      bitmap,
      DIMENSION_STEPS[DIMENSION_STEPS.length - 1],
      QUALITY_STEPS[QUALITY_STEPS.length - 1]
    );
    if (last) {
      const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([last], newName, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    }
    return file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
