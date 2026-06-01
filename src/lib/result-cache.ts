/**
 * Persistent, content-addressed cache for the expensive AI results (OCR and
 * translation). Re-analyzing the same document — the common case when staff
 * reload the page or re-run a case during review — should never re-pay for a
 * gpt-4o vision call. A cache hit returns the byte-identical prior result, so
 * this is purely a cost/latency optimization with no effect on output.
 *
 * Why client-side IndexedDB (not a server store):
 *  - The cached payloads (OCR text, translations) are document PII. Keeping them
 *    in the user's browser keeps that data on-device, consistent with the
 *    decision to remove server-side blob storage for privacy.
 *  - It works on Vercel, which has no writable server filesystem.
 *  - IndexedDB (unlike localStorage's ~5MB cap) comfortably holds many docs.
 *
 * Keys are derived from a SHA-256 of the file bytes plus PROMPT_VERSION, so a
 * change to the OCR/translation prompts invalidates every stale entry and a
 * prompt improvement is never silently served from cache.
 */
import type { OCRResult, TranslationResult } from '@/types';

/**
 * Bump this whenever the OCR or translation PROMPT changes in a way that should
 * alter output. It is part of every cache key, so bumping it transparently
 * invalidates all previously cached results.
 */
export const PROMPT_VERSION = 'v1';

const DB_NAME = 'legal-lens-cache';
const DB_VERSION = 1;
const STORE = 'results';

/** True only in a browser with IndexedDB + Web Crypto available. */
function cacheAvailable(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbGet<T>(key: string): Promise<T | null> {
  return openDb().then(
    db =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDb().then(
    db =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/**
 * SHA-256 of the file's bytes, hex-encoded. Memoized per File object so OCR and
 * translation of the same file don't read+hash the bytes twice.
 */
const hashMemo = new WeakMap<File, Promise<string>>();
export function hashFile(file: File): Promise<string> {
  const cached = hashMemo.get(file);
  if (cached) return cached;
  const p = file
    .arrayBuffer()
    .then(buf => crypto.subtle.digest('SHA-256', buf))
    .then(digest =>
      Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    );
  hashMemo.set(file, p);
  return p;
}

const ocrKey = (hash: string, languageHint?: string) =>
  `ocr:${PROMPT_VERSION}:${hash}:${languageHint ?? ''}`;

const translationKey = (
  hash: string,
  targetLanguage: string,
  languageHint?: string
) => `tr:${PROMPT_VERSION}:${hash}:${targetLanguage}:${languageHint ?? ''}`;

/** Returns a cached OCR result for this file, or null on miss / unavailable. */
export async function getCachedOcr(
  file: File,
  languageHint?: string
): Promise<OCRResult | null> {
  if (!cacheAvailable()) return null;
  try {
    return await idbGet<OCRResult>(ocrKey(await hashFile(file), languageHint));
  } catch {
    return null;
  }
}

export async function setCachedOcr(
  file: File,
  languageHint: string | undefined,
  result: OCRResult
): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    await idbSet(ocrKey(await hashFile(file), languageHint), result);
  } catch {
    /* cache write is best-effort; never block the pipeline on it */
  }
}

export async function getCachedTranslation(
  file: File,
  targetLanguage: string,
  languageHint?: string
): Promise<TranslationResult | null> {
  if (!cacheAvailable()) return null;
  try {
    return await idbGet<TranslationResult>(
      translationKey(await hashFile(file), targetLanguage, languageHint)
    );
  } catch {
    return null;
  }
}

export async function setCachedTranslation(
  file: File,
  targetLanguage: string,
  languageHint: string | undefined,
  result: TranslationResult
): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    await idbSet(
      translationKey(await hashFile(file), targetLanguage, languageHint),
      result
    );
  } catch {
    /* best-effort */
  }
}

/** Wipe all cached results. Wired to the "Clear cached results" settings control. */
export async function clearResultCache(): Promise<void> {
  if (!cacheAvailable()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
