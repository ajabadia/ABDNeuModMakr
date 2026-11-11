// ─────────────────────────────────────────────────────────
// ABDShared — kbSearch (Lexical BM25 local knowledge base search)
// Lightweight pure-TypeScript deterministic BM25 (< 130 lines, zero deps)
// ─────────────────────────────────────────────────────────

export interface KbArticle {
  id: string;
  stage?: string | number;
  tags: string[];
  triggerCodes?: string[];
  title: string;
  whatItMeans: string;
  howToFixSteps: string[];
  uiTargets?: Array<{ targetId: string; label: string }>;
}

export interface KbSearchOptions {
  stage?: string | number;
  triggerCode?: string;
  limit?: number;
}

/**
 * Normaliza diacríticos (tildes) y caracteres especiales a minúsculas ASCII.
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'en', 'con', 'por',
  'para', 'sin', 'sobre', 'entre', 'hacia', 'hasta', 'desde', 'que', 'como', 'cuando', 'donde',
  'quien', 'cual', 'cuales', 'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'es', 'son', 'fue', 'ser',
  'estar', 'esta', 'estan', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'eso', 'aquel',
  'pero', 'mas', 'sino', 'o', 'u', 'y', 'e', 'ni', 'no', 'si', 'ya', 'muy', 'mas', 'menos',
  'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'tan',
  'tanto', 'tanta', 'hacer', 'hago', 'hace', 'puedo', 'puede', 'quiero', 'quiere', 'hay', 'tiene',
  'the', 'is', 'at', 'which', 'on', 'in', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about',
  'into', 'over', 'after', 'and', 'or', 'but', 'not', 'what', 'how', 'when', 'where', 'who', 'why',
  'can', 'do', 'does', 'my', 'your', 'our', 'their', 'this', 'that', 'these', 'those', 'an', 'as', 'be', 'are'
]);

/**
 * Reducción ligera de plurales y terminaciones verbales frecuentes (ES/EN) para emparejar "creo" <-> "crear", "zonas" <-> "zona".
 */
function lightStem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ciones')) return word.slice(0, -6) + 'cion';
  if (word.endsWith('ando') || word.endsWith('iendo')) return word.slice(0, -4);
  if (word.endsWith('ar') || word.endsWith('er') || word.endsWith('ir')) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.endsWith('o') || word.endsWith('a') || word.endsWith('e')) return word.slice(0, -1);
  return word;
}

/**
 * Tokeniza texto normalizado en palabras de al menos 2 letras, filtrando stopwords opcionalmente.
 */
function tokenize(text: string, filterStopWords = false): string[] {
  const norm = normalizeText(text);
  const words = norm.match(/[a-z0-9_]{2,}/g);
  if (!words) return [];
  if (!filterStopWords) return words;
  const filtered = words.filter((w) => !STOP_WORDS.has(w));
  return filtered.length > 0 ? filtered : words;
}

/**
 * Búsqueda léxica determinista estilo BM25 sobre artículos de conocimiento.
 */
export function searchKnowledgeBase(
  articles: readonly KbArticle[],
  query: string,
  options: KbSearchOptions = {}
): KbArticle[] {
  if (!articles || articles.length === 0) return [];
  const limit = options.limit ?? 5;

  // Filtrado previo por stage o triggerCode si se solicitó
  let candidates = articles.slice();
  if (options.stage !== undefined) {
    candidates = candidates.filter((a) => a.stage === undefined || String(a.stage) === String(options.stage));
  }
  if (options.triggerCode) {
    const codeNorm = options.triggerCode.toLowerCase();
    const matchedByCode = candidates.filter((a) =>
      a.triggerCodes?.some((tc) => tc.toLowerCase() === codeNorm)
    );
    if (matchedByCode.length > 0) {
      return matchedByCode.slice(0, limit);
    }
  }

  const queryTokens = tokenize(query, true);
  if (queryTokens.length === 0) {
    return candidates.slice(0, limit);
  }

  // Pre-tokenizar documentos (exactos + raíces ligeras)
  const docTokensList = candidates.map((a) => {
    const combined = `${a.title} ${a.tags.join(' ')} ${a.whatItMeans} ${a.howToFixSteps.join(' ')} ${(a.triggerCodes || []).join(' ')}`;
    return tokenize(combined, true);
  });
  const docStemsList = docTokensList.map((toks) => toks.map(lightStem));

  const N = candidates.length;
  const avgdl = docTokensList.reduce((acc, toks) => acc + toks.length, 0) / (N || 1);
  const k1 = 1.2;
  const b = 0.75;

  // IDF por token
  const idfMap = new Map<string, number>();
  for (const qTerm of queryTokens) {
    if (!idfMap.has(qTerm)) {
      const qStem = lightStem(qTerm);
      const docCount = docTokensList.filter((toks, i) => toks.includes(qTerm) || docStemsList[i].includes(qStem)).length;
      // Formula BM25 IDF estándar
      const idf = Math.log((N - docCount + 0.5) / (docCount + 0.5) + 1.0);
      idfMap.set(qTerm, Math.max(idf, 0.05));
    }
  }

  // Calcular score BM25 para cada candidato
  const scored = candidates.map((doc, idx) => {
    const toks = docTokensList[idx];
    const stems = docStemsList[idx];
    const docLen = toks.length;
    let score = 0;

    // Bonus por coincidencia exacta o raíz en título o tags
    const normTitle = normalizeText(doc.title);
    for (const qTerm of queryTokens) {
      const qStem = lightStem(qTerm);
      if (normTitle.includes(qTerm) || (qStem.length >= 4 && normTitle.includes(qStem))) score += 2.2;
      if (doc.tags.some((t) => {
        const nt = normalizeText(t);
        return nt.includes(qTerm) || (qStem.length >= 4 && nt.includes(qStem));
      })) score += 1.8;
    }

    // Frecuencia de términos en doc
    const tfMap = new Map<string, number>();
    for (const t of toks) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }
    const stemTfMap = new Map<string, number>();
    for (const st of stems) {
      stemTfMap.set(st, (stemTfMap.get(st) || 0) + 1);
    }

    for (const qTerm of queryTokens) {
      const exactTf = tfMap.get(qTerm) || 0;
      const stemTf = exactTf > 0 ? exactTf : (stemTfMap.get(lightStem(qTerm)) || 0) * 0.75;
      if (stemTf > 0) {
        const idf = idfMap.get(qTerm) || 0.1;
        const numerator = stemTf * (k1 + 1);
        const denominator = stemTf + k1 * (1 - b + b * (docLen / avgdl));
        score += idf * (numerator / denominator);
      }
    }

    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.doc);
}
