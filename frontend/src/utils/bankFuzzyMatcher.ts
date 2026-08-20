/**
 * Universal Fuzzy Bank Matcher & Synonym Normalizer for inkCRM
 * Supports: Case-insensitivity, spelling typos, common acronyms, and substring matching.
 */

// Bank Synonym Dictionary (Acronyms <-> Full Names)
const BANK_SYNONYMS: Record<string, string[]> = {
  sbi: ['sbi', 'state bank of india', 'state bank', 'statebank'],
  hdfc: ['hdfc', 'hdfc bank', 'hdfc bank ltd', 'hdfcbank'],
  icici: ['icici', 'icici bank', 'icici bank ltd', 'icicibank', 'icic'],
  kotak: ['kotak', 'kotak mahindra', 'kotak mahindra bank', 'kotak bank', 'kothak'],
  axis: ['axis', 'axis bank', 'axisbank', 'axiss'],
  bob: ['bob', 'bank of baroda', 'baroda', 'barodabank'],
  boi: ['boi', 'bank of india'],
  pnb: ['pnb', 'punjab national bank', 'punjab national'],
  canara: ['canara', 'canara bank'],
  union: ['union', 'union bank', 'union bank of india', 'ubi'],
  idfc: ['idfc', 'idfc first', 'idfc first bank', 'idfc bank', 'idfcbank'],
  indusind: ['indusind', 'indus ind', 'indusind bank', 'indus'],
  yes: ['yes', 'yes bank', 'yesbank'],
  bandhan: ['bandhan', 'bandhan bank'],
  rbl: ['rbl', 'rbl bank', 'ratnakar bank'],
  au: ['au', 'au small finance', 'au small finance bank', 'au bank'],
  equitas: ['equitas', 'equitas small finance', 'equitas bank'],
  federal: ['federal', 'federal bank'],
  stanc: ['stanc', 'standard chartered', 'standard chartered bank', 'scb'],
  hsbc: ['hsbc', 'hongkong and shanghai', 'hsbc bank'],
  citi: ['citi', 'citibank'],
  dbs: ['dbs', 'dbs bank'],
  central: ['central bank', 'central bank of india', 'cbi'],
  indian: ['indian bank', 'ib'],
  uco: ['uco', 'uco bank'],
  psb: ['psb', 'punjab and sind bank'],
  bom: ['bom', 'bank of maharashtra', 'maharashtra bank']
};

/**
 * Clean & normalize a string into lowercase alphanumeric characters
 */
export function normalizeBankName(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Calculates Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Robust fuzzy matching for Bank names.
 * Handles:
 * - Upper / Lowercase variations
 * - Acronyms (e.g. SBI <-> State Bank of India)
 * - Substring matches (e.g. HDFC <-> HDFC Bank Ltd)
 * - Spelling typos (e.g. axiss, hdffc, kothak)
 */
export function isBankMatch(query: string, bankName: string): boolean {
  if (!query || !bankName) return false;

  const normQuery = normalizeBankName(query);
  const normBank = normalizeBankName(bankName);

  if (!normQuery || !normBank) return false;

  // 1. Direct equality
  if (normQuery === normBank) return true;

  // 2. Substring matching (either direction)
  if (normBank.includes(normQuery) || normQuery.includes(normBank)) return true;

  // 3. Synonym / Acronym dictionary check
  for (const group of Object.values(BANK_SYNONYMS)) {
    const normGroup = group.map(normalizeBankName);
    const queryInGroup = normGroup.some(g => g === normQuery || normQuery.includes(g) || g.includes(normQuery));
    const bankInGroup = normGroup.some(g => g === normBank || normBank.includes(g) || g.includes(normBank));

    if (queryInGroup && bankInGroup) return true;
  }

  // 4. Fuzzy Levenshtein Distance for minor spelling mistakes (if query length >= 3)
  if (normQuery.length >= 3 && normBank.length >= 3) {
    // Allow distance of 1 for short queries, 2 for longer queries
    const maxAllowedDistance = normQuery.length <= 4 ? 1 : 2;
    const distance = levenshteinDistance(normQuery, normBank);
    if (distance <= maxAllowedDistance) return true;
  }

  return false;
}

/**
 * Filter an array of bank names using fuzzy matching
 */
export function filterBanksFuzzy(bankList: string[], query: string): string[] {
  if (!query || !query.trim()) return bankList;
  return bankList.filter(bank => isBankMatch(query, bank));
}
