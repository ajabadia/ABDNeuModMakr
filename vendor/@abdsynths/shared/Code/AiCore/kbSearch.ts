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

/**
 * Tokeniza texto normalizado en palabras de al menos 2 letras.
 */
function tokenize(text: string): string[] {
  const norm = normalizeText(text);
  const words = norm.match(/[a-z0-9_]{2,}/g);
  return words ? words : [];
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

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return candidates.slice(0, limit);
  }

  // Pre-tokenizar documentos
  const docTokensList = candidates.map((a) => {
    const combined = `${a.title} ${a.tags.join(' ')} ${a.whatItMeans} ${a.howToFixSteps.join(' ')} ${(a.triggerCodes || []).join(' ')}`;
    return tokenize(combined);
  });

  const N = candidates.length;
  const avgdl = docTokensList.reduce((acc, toks) => acc + toks.length, 0) / (N || 1);
  const k1 = 1.2;
  const b = 0.75;

  // IDF por token
  const idfMap = new Map<string, number>();
  for (const qTerm of queryTokens) {
    if (!idfMap.has(qTerm)) {
      const docCount = docTokensList.filter((toks) => toks.includes(qTerm)).length;
      // Formula BM25 IDF estándar
      const idf = Math.log((N - docCount + 0.5) / (docCount + 0.5) + 1.0);
      idfMap.set(qTerm, Math.max(idf, 0.05));
    }
  }

  // Calcular score BM25 para cada candidato
  const scored = candidates.map((doc, idx) => {
    const toks = docTokensList[idx];
    const docLen = toks.length;
    let score = 0;

    // Bonus por coincidencia exacta en título o tags
    const normTitle = normalizeText(doc.title);
    for (const qTerm of queryTokens) {
      if (normTitle.includes(qTerm)) score += 2.0;
      if (doc.tags.some((t) => normalizeText(t).includes(qTerm))) score += 1.5;
    }

    // Frecuencia de términos en doc
    const tfMap = new Map<string, number>();
    for (const t of toks) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    for (const qTerm of queryTokens) {
      const tf = tfMap.get(qTerm) || 0;
      if (tf > 0) {
        const idf = idfMap.get(qTerm) || 0.1;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLen / avgdl));
        score += idf * (numerator / denominator);
      }
    }

    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.doc);
}
