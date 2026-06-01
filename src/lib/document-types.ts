/**
 * Document-type guidance registry for document-type-specific validation.
 *
 * NOT a hard enum — `documentType` remains free text. This registry lets the
 * Phase-1 analysis prompt know what a genuine instance of a given document type
 * normally contains, so it can flag missing/structurally-suspicious fields
 * (e.g. a birth certificate with no registration number). A small
 * `requiredFields` subset also drives a deterministic backstop flag.
 *
 * Pure data + matchers — safe to import on client or server.
 */

export interface DocTypeSpec {
  /** Stable key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Lowercase substrings that, if present in the detected document_type, match this spec. */
  match: string[];
  /** Fields a genuine instance of this document normally contains (prompt guidance). */
  expectedFields: string[];
  /**
   * Critical fields whose absence is genuinely suspicious. Drives a deterministic
   * backstop flag (checked against keyFields via canonicalizeField).
   */
  requiredFields?: string[];
  /** Short structural note injected into the prompt. */
  notes: string;
}

export const DOCUMENT_TYPE_SPECS: DocTypeSpec[] = [
  {
    key: 'passport',
    label: 'Passport',
    match: ['passport'],
    expectedFields: ['Full Name', 'Date of Birth', 'Passport Number', 'Nationality', 'Issue Date', 'Expiry Date', 'Place of Birth', 'Issuing Authority'],
    requiredFields: ['Passport Number'],
    notes: 'A passport should carry a passport number, issue and expiry dates, nationality, and an issuing authority.',
  },
  {
    key: 'national_id',
    label: 'National ID / Tazkera',
    match: ['national id', 'tazkera', 'tazkira', 'identity card', 'id card', 'cnic'],
    expectedFields: ["Full Name", "Father's Name", 'Date of Birth', 'National ID Number', 'Place of Birth'],
    requiredFields: ['National ID Number'],
    notes: "An Afghan Tazkera typically records the holder's name, father's and grandfather's names, a volume/page/record (jeld/safha/sabt) number, and an issuing office.",
  },
  {
    key: 'birth_certificate',
    label: 'Birth Certificate',
    match: ['birth'],
    expectedFields: ['Full Name', 'Date of Birth', 'Place of Birth', "Father's Name", "Mother's Name", 'Registration Number', 'Issuing Authority'],
    requiredFields: ['Registration Number'],
    notes: 'A birth certificate should carry a registration/certificate number, a registration date, place of birth, parents\' names, and an issuing registrar/authority. A missing registration number is suspicious.',
  },
  {
    key: 'marriage_certificate',
    label: 'Marriage Certificate',
    match: ['marriage', 'nikah'],
    expectedFields: ["Spouse's Name", 'Date', 'Place', 'Registration Number', 'Issuing Authority'],
    notes: "A marriage certificate should record both spouses' names, the marriage date and place, and a registration number/authority.",
  },
  {
    key: 'divorce_certificate',
    label: 'Divorce Certificate',
    match: ['divorce', 'talaq'],
    expectedFields: ["Spouse's Name", 'Date', 'Registration Number', 'Issuing Authority'],
    notes: 'A divorce document should record both parties, the date, and an issuing authority/court.',
  },
  {
    key: 'i589',
    label: 'Form I-589 (US Asylum Application)',
    match: ['i-589', 'i589', 'asylum'],
    expectedFields: ['Full Name', 'Date of Birth', 'Nationality', 'Address'],
    notes: 'Form I-589 lists the applicant and family members (spouse, children, parents, siblings) with names, dates of birth, and locations — high-value for cross-referencing family information.',
  },
  {
    key: 'imm5406',
    label: 'Form IMM 5406 (Additional Family Information)',
    match: ['imm 5406', 'imm5406', '5406'],
    expectedFields: ['Full Name', 'Date of Birth', 'Marital Status', 'Address'],
    notes: 'IMM 5406 lists family members with dates of birth, marital status, and addresses.',
  },
  {
    key: 'imm5645',
    label: 'Form IMM 5645 (Family Information)',
    match: ['imm 5645', 'imm5645', '5645'],
    expectedFields: ['Full Name', 'Date of Birth', 'Marital Status', 'Address'],
    notes: 'IMM 5645 lists family members (spouse, children, parents, siblings) with dates of birth and marital status.',
  },
  {
    key: 'basis_of_claim',
    label: 'Basis of Claim form',
    match: ['basis of claim', 'boc'],
    expectedFields: ['Full Name', 'Date of Birth'],
    notes: 'The Basis of Claim form (especially the family-members page) lists relatives with names and dates of birth.',
  },
  {
    key: 'drivers_license',
    label: "Driver's License",
    match: ['driver', 'licence', 'license'],
    expectedFields: ['Full Name', 'Date of Birth', 'Issue Date', 'Expiry Date', 'Address'],
    notes: 'A driving licence should have an issue date, expiry date, and licence number.',
  },
];

/** Find the registry spec whose match-substrings appear in the detected document type. */
export function matchDocTypeSpec(documentType: string | undefined): DocTypeSpec | undefined {
  if (!documentType) return undefined;
  const t = documentType.toLowerCase();
  return DOCUMENT_TYPE_SPECS.find(spec => spec.match.some(m => t.includes(m)));
}
