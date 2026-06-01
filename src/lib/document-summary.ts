/**
 * Client-safe document summary builder.
 * Converts a DocumentGroup (OCR + translation data) into a compact DocumentSummary
 * without making any AI calls. Used for "light" report mode (Phase 1 / Map phase).
 *
 * This file has NO server-side imports so it can be loaded in client hooks.
 */
import type { DocumentGroup, DocumentSummary } from '@/types';

const CONF_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Build a compact DocumentSummary from a DocumentGroup's OCR + translation data.
 * All key fields are derived from structured_data — no AI call required.
 */
export function buildDocumentSummaryFromOCR(group: DocumentGroup): DocumentSummary {
  const allOrigFields: Array<{ key: string; value: string }> = [];
  const allTransFields: Array<{ key: string; value: string }> = [];
  let docType = 'Unknown';
  let docLang = 'Unknown';
  let translationNotes = '';
  let worstConfRank = 0;
  let isHandwritten = false;

  for (const page of group.pages) {
    const ocr = page.extracted_data;
    const tr = page.translation_data;

    if (ocr) {
      if (docType === 'Unknown' && ocr.document_type) docType = ocr.document_type;
      if (docLang === 'Unknown' && ocr.document_language) docLang = ocr.document_language;
      const fields = (ocr.structured_data?.fields ?? []) as Array<{ key: string; value: string }>;
      allOrigFields.push(...fields);
      const conf = (ocr.illegibility?.confidence as string | undefined) ?? 'high';
      const rank = CONF_RANK[conf] ?? 0;
      if (rank > worstConfRank) worstConfRank = rank;
      if (ocr.illegibility?.handwritten === true) isHandwritten = true;
    }

    if (tr) {
      const transFields = (tr.structured_data?.translated_fields ?? []) as Array<{
        key: string;
        value: string;
      }>;
      allTransFields.push(...transFields);
      if (tr.notes) translationNotes += (translationNotes ? ' | ' : '') + tr.notes;
    }
  }

  const origMap = new Map(allOrigFields.map(f => [f.key.toLowerCase(), f.value]));
  const transMap = new Map(allTransFields.map(f => [f.key.toLowerCase(), f.value]));

  const getField = (...keys: string[]) => {
    for (const k of keys) {
      const val = origMap.get(k) ?? transMap.get(k);
      if (val && val.trim()) return val.trim();
    }
    return 'N/A';
  };

  const issuingAuthority = getField(
    'issuing authority',
    'issued by',
    'authority',
    'place of issue',
    'issued at',
    'place of issuance',
  );
  const issueDate = getField(
    'issue date',
    'date of issue',
    'issued on',
    'date issued',
    'registration date',
    'date of registration',
  );
  const validity = getField(
    'expiry date',
    'expiration date',
    'valid until',
    'date of expiry',
    'valid to',
    'validity',
    'date of expiration',
  );

  // Build keyFields — translated fields first (more useful for comparison),
  // then fill gaps from original-only fields.
  const seenKeys = new Set<string>();
  const keyFields: Array<{ field: string; original: string; translated: string }> = [];

  for (const tf of allTransFields) {
    const lk = tf.key.toLowerCase();
    if (seenKeys.has(lk)) continue;
    seenKeys.add(lk);
    keyFields.push({
      field: tf.key,
      original: origMap.get(lk) ?? '',
      translated: tf.value,
    });
    if (keyFields.length >= 15) break;
  }

  for (const of_ of allOrigFields) {
    if (seenKeys.has(of_.key.toLowerCase())) continue;
    seenKeys.add(of_.key.toLowerCase());
    keyFields.push({ field: of_.key, original: of_.value, translated: '' });
    if (keyFields.length >= 15) break;
  }

  // Hand-written values are inherently lower-confidence for OCR, so never
  // rate a handwritten document "Good" (mirrors the deep-mode rule).
  const baseLegibility: 'Good' | 'Fair' | 'Poor' =
    worstConfRank >= 2 ? 'Poor' : worstConfRank === 1 ? 'Fair' : 'Good';
  const legibility: 'Good' | 'Fair' | 'Poor' =
    isHandwritten && baseLegibility === 'Good' ? 'Fair' : baseLegibility;

  const flags: string[] = [];
  if (legibility !== 'Good') flags.push(`Legibility: ${legibility}`);
  if (isHandwritten) flags.push('Handwritten content detected');
  if (keyFields.length === 0) flags.push('No structured fields extracted');

  return {
    documentName: group.name,
    documentType: docType,
    issuingAuthority,
    issueDate,
    validity,
    originalLanguage: docLang,
    legibility,
    isHandwritten,
    keyFields,
    flags,
    translationNotes,
    familyMemberId: group.familyMemberId,
    familyMemberName: group.familyMemberName,
  };
}
