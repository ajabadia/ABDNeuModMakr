// ─────────────────────────────────────────────────────────
// ABDShared — CopilotOrchestrator
// Universal domain-agnostic conversational orchestrator with structured JSON actions.
// ─────────────────────────────────────────────────────────

import { LocalLlmClient } from './LocalLlmClient';
import { CloudByokClient, parseJsonObjectSafe } from './CloudByokClient';
import { searchKnowledgeBase, type KbArticle } from './kbSearch';

export interface CopilotToolParamSpec {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description: string;
  enumValues?: readonly (string | number)[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface CopilotToolSpec {
  name: string;
  description: string;
  scopes?: readonly string[];
  readOnlyNavigation?: boolean;
  destructive?: boolean;
  params: Record<string, CopilotToolParamSpec>;
  formatPreviewDiff?: (args: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; undoLabel?: string }>;
}

export interface CopilotProposedAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  previewDiff: string;
  readOnlyNavigation: boolean;
  destructive: boolean;
}

export interface CopilotTurnResult {
  reply: string;
  highlightTargets: string[];
  proposedActions: CopilotProposedAction[];
  engineLabel: string;
  privacyMode: 'deterministic' | 'local-private' | 'cloud-metadata';
}

export interface CopilotOrchestratorConfig {
  engineMode: 'deterministic' | 'local-llm' | 'cloud-byok';
  cloudProviderOverride?: string;
  actionExecutionMode: 'confirm-always' | 'autopilot-safe';
  anonymizeCloudMetadata: boolean;
}

export interface CopilotHostContext {
  activeScope?: string;
  systemPromptBase: string;
  knowledgeBase: readonly KbArticle[];
  sessionSnapshot: Record<string, unknown>;
  allowedUiTargets: readonly string[];
}

export const COPILOT_CONFIG_STORAGE_KEY = 'abdsynths.ai.copilot.v1';

export const DEFAULT_COPILOT_CONFIG: CopilotOrchestratorConfig = {
  engineMode: 'deterministic',
  actionExecutionMode: 'confirm-always',
  anonymizeCloudMetadata: false,
};

export class CopilotOrchestrator {
  private config: CopilotOrchestratorConfig = { ...DEFAULT_COPILOT_CONFIG };
  private tools = new Map<string, CopilotToolSpec>();
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(
    private readonly localLlm: LocalLlmClient,
    private readonly cloudByok: CloudByokClient
  ) {
    this.loadFromStorage();
  }

  public loadFromStorage(): CopilotOrchestratorConfig {
    if (typeof localStorage === 'undefined') return { ...this.config };
    try {
      const raw = localStorage.getItem(COPILOT_CONFIG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CopilotOrchestratorConfig>;
        this.config = { ...DEFAULT_COPILOT_CONFIG, ...parsed };
      }
    } catch {}
    return { ...this.config };
  }

  public saveToStorage(cfg: Partial<CopilotOrchestratorConfig>): void {
    this.config = { ...this.config, ...cfg };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COPILOT_CONFIG_STORAGE_KEY, JSON.stringify(this.config));
    }
  }

  public getConfig(): CopilotOrchestratorConfig {
    return { ...this.config };
  }

  public registerTool(tool: CopilotToolSpec): void {
    this.tools.set(tool.name, tool);
  }

  public clearTools(): void {
    this.tools.clear();
  }

  public clearHistory(): void {
    this.conversationHistory = [];
  }

  public getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }

  public async processTurn(
    userMessage: string,
    hostContext: CopilotHostContext,
    signal?: AbortSignal
  ): Promise<CopilotTurnResult> {
    const trimmedMsg = userMessage.trim();
    if (!trimmedMsg) {
      return {
        reply: 'Introduce una consulta para comenzar.',
        highlightTargets: [],
        proposedActions: [],
        engineLabel: 'Guía Determinista Local',
        privacyMode: 'deterministic',
      };
    }

    // 1. Si está en modo puramente determinista, busca en la KB y devuelve respuesta basada en reglas
    if (this.config.engineMode === 'deterministic') {
      return this.processDeterministicTurn(trimmedMsg, hostContext);
    }

    // 2. Si está en modo Local LLM o Cloud BYOK, orquesta llamada estructurada
    const engineMode = this.config.engineMode;
    const isCloud = engineMode === 'cloud-byok';

    // Anonimizar metadatos si está activado para Cloud
    const cleanSnapshot = isCloud && this.config.anonymizeCloudMetadata
      ? this.anonymizeMetadata(hostContext.sessionSnapshot)
      : hostContext.sessionSnapshot;

    // Filtrar herramientas activas por scope (máx 6)
    const availableTools = Array.from(this.tools.values()).filter((t) => {
      if (!t.scopes || t.scopes.length === 0) return true;
      if (!hostContext.activeScope) return t.scopes.includes('global');
      return t.scopes.includes('global') || t.scopes.includes(hostContext.activeScope);
    }).slice(0, 6);

    // Búsqueda de artículos relevantes de KB (máx 3)
    const relevantArticles = searchKnowledgeBase(hostContext.knowledgeBase, trimmedMsg, { limit: 3 });

    // Construir System Prompt con schema y catálogo estricto
    const systemPrompt = this.buildFullSystemPrompt(
      hostContext.systemPromptBase,
      cleanSnapshot,
      availableTools,
      relevantArticles,
      hostContext.allowedUiTargets
    );

    let rawReply = '';
    let engineLabel = '';

    try {
      if (engineMode === 'local-llm') {
        const localCfg = this.localLlm.getConfig();
        engineLabel = `Ollama Local (${localCfg.activeModel || 'Auto'})`;
        const res = await this.localLlm.generateText(trimmedMsg, {
          systemPrompt,
          messages: this.conversationHistory,
          jsonMode: true,
          signal,
          temperature: 0.2,
        });
        rawReply = res.text;
      } else {
        const provider = (this.config.cloudProviderOverride as any) || this.cloudByok.getConfig().provider;
        engineLabel = `Cloud BYOK (${provider})`;
        const res = await this.cloudByok.generateText(trimmedMsg, {
          provider,
          systemPrompt,
          messages: this.conversationHistory,
          jsonMode: true,
          signal,
          temperature: 0.2,
        });
        rawReply = res.text;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        reply: `Error al comunicar con ${engineLabel}: ${errMsg}`,
        highlightTargets: [],
        proposedActions: [],
        engineLabel,
        privacyMode: isCloud ? 'cloud-metadata' : 'local-private',
      };
    }

    // Parsear y validar defensivamente el JSON devuelto
    const parsed = parseJsonObjectSafe<{
      reply?: string;
      highlightTargets?: string[];
      proposedActions?: Array<{ tool: string; args?: Record<string, unknown>; label?: string }>;
    }>(rawReply);

    let finalReply = parsed?.reply?.trim() || rawReply.trim();
    if (!finalReply) {
      finalReply = 'No se pudo generar una respuesta válida.';
    }

    // Validar highlightTargets contra lista blanca del host
    const allowedTargetsSet = new Set(hostContext.allowedUiTargets);
    const validHighlights = (parsed?.highlightTargets || []).filter((id) =>
      typeof id === 'string' && allowedTargetsSet.has(id)
    );

    // Validar propuestas de acción
    const validProposedActions: CopilotProposedAction[] = [];
    if (Array.isArray(parsed?.proposedActions)) {
      for (const act of parsed.proposedActions) {
        if (!act || typeof act !== 'object' || typeof act.tool !== 'string') continue;
        const toolSpec = this.tools.get(act.tool);
        if (!toolSpec) continue; // Descartar herramientas alucinadas que no existen

        const args = (act.args && typeof act.args === 'object' && !Array.isArray(act.args)) ? act.args : {};
        const validation = this.validateToolArguments(toolSpec, args);
        if (!validation.valid) continue; // Descartar llamadas con parámetros inválidos

        const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const diff = toolSpec.formatPreviewDiff ? toolSpec.formatPreviewDiff(validation.sanitizedArgs) : JSON.stringify(validation.sanitizedArgs);
        validProposedActions.push({
          id: actionId,
          tool: toolSpec.name,
          args: validation.sanitizedArgs,
          label: act.label?.trim() || toolSpec.description,
          previewDiff: diff,
          readOnlyNavigation: Boolean(toolSpec.readOnlyNavigation),
          destructive: Boolean(toolSpec.destructive),
        });
      }
    }

    // Actualizar historial conversacional acotado (máx 8 mensajes / 4 pares)
    this.conversationHistory.push({ role: 'user', content: trimmedMsg });
    this.conversationHistory.push({ role: 'assistant', content: finalReply });
    if (this.conversationHistory.length > 8) {
      this.conversationHistory = this.conversationHistory.slice(-8);
    }

    return {
      reply: finalReply,
      highlightTargets: validHighlights,
      proposedActions: validProposedActions,
      engineLabel,
      privacyMode: isCloud ? 'cloud-metadata' : 'local-private',
    };
  }

  private processDeterministicTurn(query: string, hostContext: CopilotHostContext): CopilotTurnResult {
    const hits = searchKnowledgeBase(hostContext.knowledgeBase, query, { limit: 2 });
    if (hits.length === 0) {
      return {
        reply: `No encontré artículos exactos para "${query}" en el manual integrado. Puedes activar Ollama local o Cloud BYOK en Ajustes para conversar libremente.`,
        highlightTargets: [],
        proposedActions: [],
        engineLabel: 'Guía Determinista Local',
        privacyMode: 'deterministic',
      };
    }

    const first = hits[0];
    const stepsFormatted = first.howToFixSteps.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
    const reply = `**${first.title}**\n\n${first.whatItMeans}\n\n**Pasos recomendados:**\n${stepsFormatted}`;
    const highlights = (first.uiTargets || []).map((t) => t.targetId).filter((id) =>
      hostContext.allowedUiTargets.includes(id)
    );

    return {
      reply,
      highlightTargets: highlights,
      proposedActions: [],
      engineLabel: 'Guía Determinista Local',
      privacyMode: 'deterministic',
    };
  }

  private buildFullSystemPrompt(
    basePrompt: string,
    snapshot: Record<string, unknown>,
    tools: CopilotToolSpec[],
    articles: KbArticle[],
    allowedTargets: readonly string[]
  ): string {
    const toolsJson = tools.map((t) => ({
      name: t.name,
      description: t.description,
      readOnlyNavigation: t.readOnlyNavigation,
      destructive: t.destructive,
      params: t.params,
    }));

    const articlesJson = articles.map((a) => ({
      title: a.title,
      whatItMeans: a.whatItMeans,
      howToFixSteps: a.howToFixSteps,
    }));

    return `${basePrompt}

=== ESTADO ACTUAL DE LA SESIÓN EN TIEMPO REAL ===
${JSON.stringify(snapshot, null, 2)}

=== ARTÍCULOS RELEVANTES DE LA BASE DE CONOCIMIENTO ===
${JSON.stringify(articlesJson, null, 2)}

=== HERRAMIENTAS PERMITIDAS EN ESTE TURNO (CERO ALUCINACIONES) ===
${JSON.stringify(toolsJson, null, 2)}

=== CONTROLES DE INTERFAZ PERMITIDOS PARA RESALTADO (highlightTargets) ===
${JSON.stringify(allowedTargets)}

=== FORMATO DE RESPUESTA OBLIGATORIO (JSON ESTRICTO) ===
Debes responder con un único objeto JSON que cumpla esta estructura:
{
  "reply": "Tu explicación en markdown claro. Usa [[target:ID|Texto]] para citar controles reales de la interfaz.",
  "highlightTargets": ["id1", "id2"],
  "proposedActions": [
    {
      "tool": "nombre_de_herramienta_exacta",
      "args": { "param1": "valor" },
      "label": "Acción breve para el botón"
    }
  ]
}
No inventes herramientas que no estén en la lista. Si ninguna herramienta aplica, "proposedActions" debe ser [].`;
  }

  public validateToolArguments(
    tool: CopilotToolSpec,
    rawArgs: Record<string, unknown>
  ): { valid: boolean; sanitizedArgs: Record<string, unknown>; error?: string } {
    const sanitized: Record<string, unknown> = {};

    for (const [paramName, spec] of Object.entries(tool.params)) {
      const val = rawArgs[paramName];
      if (val === undefined || val === null) {
        if (spec.required) {
          return { valid: false, sanitizedArgs: {}, error: `Missing required param: ${paramName}` };
        }
        continue;
      }

      if (spec.type === 'string') {
        if (typeof val !== 'string') return { valid: false, sanitizedArgs: {}, error: `Expected string for ${paramName}` };
        let strVal = val;
        if (spec.maxLength && strVal.length > spec.maxLength) {
          strVal = strVal.slice(0, spec.maxLength);
        }
        if (spec.enumValues && !spec.enumValues.includes(strVal)) {
          return { valid: false, sanitizedArgs: {}, error: `Invalid enum value for ${paramName}` };
        }
        sanitized[paramName] = strVal;
      } else if (spec.type === 'number') {
        const num = Number(val);
        if (!Number.isFinite(num)) return { valid: false, sanitizedArgs: {}, error: `Expected number for ${paramName}` };
        if (spec.min !== undefined && num < spec.min) return { valid: false, sanitizedArgs: {}, error: `Number ${num} < min ${spec.min}` };
        if (spec.max !== undefined && num > spec.max) return { valid: false, sanitizedArgs: {}, error: `Number ${num} > max ${spec.max}` };
        if (spec.enumValues && !spec.enumValues.includes(num)) {
          return { valid: false, sanitizedArgs: {}, error: `Invalid enum number for ${paramName}` };
        }
        sanitized[paramName] = num;
      } else if (spec.type === 'boolean') {
        sanitized[paramName] = Boolean(val);
      }
    }

    return { valid: true, sanitizedArgs: sanitized };
  }

  private anonymizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
    const str = JSON.stringify(obj);
    const cleaned = str
      .replace(/[A-Za-z]:\\[^"'\\]+/g, 'C:\\Samples')
      .replace(/\/Users\/[^"'/]+/g, '/Users/user')
      .replace(/\/home\/[^"'/]+/g, '/home/user');
    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return obj;
    }
  }
}
