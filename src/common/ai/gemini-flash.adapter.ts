import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProviderPort,
  AiStructuredResult,
  CommunicationDraft,
  DamageAnalysis,
  ExpenseCategorization,
  IdentityExtraction,
  MaintenanceTriage,
  PaymentProofExtraction,
  RepairEstimate,
  SearchDsl,
} from '../ports/ai-provider.port';

@Injectable()
export class GeminiFlashAdapter implements AiProviderPort {
  private readonly logger = new Logger(GeminiFlashAdapter.name);
  private readonly model: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-3.5-flash');
    this.apiKey = this.config.get<string>('GEMINI_API_KEY', '');
  }

  private wrap<T>(
    data: T,
    confidence: Record<string, number> = {},
    usageUnits = 0,
  ): AiStructuredResult<T> {
    return { data, confidence, model: this.model, usageUnits };
  }

  private async generateJson<T>(
    prompt: string,
    parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
  ): Promise<{ data: T; usageUnits: number }> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY missing');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const contentParts = parts?.length
      ? parts
      : [{ text: prompt }];
    if (parts?.length && !parts.some((p) => p.text)) {
      contentParts.unshift({ text: prompt });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: contentParts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      this.logger.warn(`Gemini error: ${json.error?.message ?? res.status}`);
      throw new Error(json.error?.message ?? 'Gemini request failed');
    }
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ??
      '{}';
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = {} as T;
    }
    return {
      data,
      usageUnits: json.usageMetadata?.totalTokenCount ?? 0,
    };
  }

  async extractPaymentProof(input: {
    imageUrl?: string;
    base64?: string;
    mimeType?: string;
  }): Promise<AiStructuredResult<PaymentProofExtraction>> {
    const prompt = `Extract payment proof fields as JSON with keys:
bank, senderName, recipientName, amount (number), transactionAt (ISO string if possible), referenceNumber.
If unknown use null. Only JSON.`;
    try {
      const parts: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }> = [{ text: prompt }];
      if (input.base64) {
        parts.push({
          inlineData: {
            mimeType: input.mimeType ?? 'image/jpeg',
            data: input.base64.replace(/^data:[^;]+;base64,/, ''),
          },
        });
      } else if (input.imageUrl) {
        parts[0] = {
          text: `${prompt}\nImage URL (describe if cannot fetch): ${input.imageUrl}`,
        };
      }
      const { data, usageUnits } =
        await this.generateJson<PaymentProofExtraction>(prompt, parts);
      return this.wrap(data, { overall: 0.7 }, usageUnits);
    } catch (e) {
      this.logger.warn(`extractPaymentProof fallback: ${String(e)}`);
      return this.wrap({});
    }
  }

  async extractIdentity(input: {
    imageUrl?: string;
    base64?: string;
    mimeType?: string;
  }): Promise<AiStructuredResult<IdentityExtraction>> {
    const prompt = `Extract Indonesian KTP fields as JSON:
nik (16 digits), fullName, birthPlace, birthDate (YYYY-MM-DD), address, gender (L/P or text), maritalStatus, phone, email.
Only JSON, null if unknown. Normalize NIK digits only.`;
    try {
      const parts: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }> = [{ text: prompt }];
      if (input.base64) {
        parts.push({
          inlineData: {
            mimeType: input.mimeType ?? 'image/jpeg',
            data: input.base64.replace(/^data:[^;]+;base64,/, ''),
          },
        });
      }
      const { data, usageUnits } =
        await this.generateJson<IdentityExtraction>(prompt, parts);
      return this.wrap(data, { overall: 0.65 }, usageUnits);
    } catch {
      return this.wrap({});
    }
  }

  async categorizeExpense(input: {
    description: string;
    vendor?: string;
    amount?: number;
  }): Promise<AiStructuredResult<ExpenseCategorization>> {
    const prompt = `Categorize boarding-house expense. JSON:
{"categories":[{"key":"electricity|water|maintenance|salary|supplies|internet|tax|other","label":"...","confidence":0-1}],"suggestedVendor":"...","recurring":boolean}
Description: ${input.description}
Vendor: ${input.vendor ?? ''}
Amount: ${input.amount ?? ''}`;
    try {
      const { data, usageUnits } =
        await this.generateJson<ExpenseCategorization>(prompt);
      if (!data.categories?.length) {
        data.categories = [
          { key: 'other', label: 'Lainnya', confidence: 0.3 },
        ];
      }
      return this.wrap(data, {}, usageUnits);
    } catch {
      return this.wrap({
        categories: [{ key: 'other', label: 'Lainnya', confidence: 0.2 }],
      });
    }
  }

  async draftCommunication(input: {
    purpose: string;
    audience: string;
    context: Record<string, unknown>;
    tone: string;
    channel: string;
  }): Promise<AiStructuredResult<CommunicationDraft>> {
    const prompt = `Draft Indonesian message for boarding house ops. JSON:
{"subject":"...","body":"...","tone":"${input.tone}"}
Do not invent amounts/dates not in context.
Purpose: ${input.purpose}
Audience: ${input.audience}
Channel: ${input.channel}
Context: ${JSON.stringify(input.context)}`;
    try {
      const { data, usageUnits } =
        await this.generateJson<CommunicationDraft>(prompt);
      return this.wrap(
        {
          subject: data.subject,
          body: data.body ?? `[Draft] ${input.purpose}`,
          tone: data.tone ?? input.tone,
        },
        {},
        usageUnits,
      );
    } catch {
      return this.wrap({
        body: `[Draft] ${input.purpose}`,
        tone: input.tone,
      });
    }
  }

  async triageMaintenance(input: {
    description: string;
    categoryHint?: string;
  }): Promise<AiStructuredResult<MaintenanceTriage>> {
    const lower = input.description.toLowerCase();
    const hazards: string[] = [];
    const safety: string[] = [];
    if (
      /api|kabel|listrik|gas|bakar|asap/.test(lower)
    ) {
      hazards.push('electrical_or_fire_risk');
      safety.push(
        'Matikan sumber listrik/gas jika aman. Jauhkan penyewa. Hubungi teknisi.',
      );
    }
    const prompt = `Triage maintenance report. JSON:
{"category":"...","urgency":"low|medium|high|critical","hazards":[],"recommendedSkill":"...","checklist":[],"safetyInstructions":[]}
Description: ${input.description}
Hint: ${input.categoryHint ?? ''}`;
    try {
      const { data, usageUnits } =
        await this.generateJson<MaintenanceTriage>(prompt);
      return this.wrap(
        {
          ...data,
          hazards: [...(data.hazards ?? []), ...hazards],
          safetyInstructions: [
            ...(data.safetyInstructions ?? []),
            ...safety,
          ],
          urgency: hazards.length ? 'high' : data.urgency ?? 'medium',
        },
        {},
        usageUnits,
      );
    } catch {
      return this.wrap({
        category: 'general',
        urgency: hazards.length ? 'high' : 'medium',
        hazards,
        safetyInstructions: safety,
      });
    }
  }

  async analyzeDamage(input: {
    imageUrls: string[];
    description?: string;
  }): Promise<AiStructuredResult<DamageAnalysis>> {
    const prompt = `Analyze room damage. JSON non-legal:
{"observations":[],"affectedAreas":[],"severitySuggestion":"low|medium|high","uncertaintyNotes":[]}
Description: ${input.description ?? ''}
Images: ${input.imageUrls.join(', ')}
No blame assignment.`;
    try {
      const { data, usageUnits } =
        await this.generateJson<DamageAnalysis>(prompt);
      return this.wrap(data, {}, usageUnits);
    } catch {
      return this.wrap({
        observations: [],
        uncertaintyNotes: ['Analysis unavailable'],
      });
    }
  }

  async estimateRepair(input: {
    description: string;
    imageUrls?: string[];
    priceBook?: Array<{ name: string; unitPrice: number }>;
  }): Promise<AiStructuredResult<RepairEstimate>> {
    const prompt = `Estimate repair cost IDR. JSON non-binding:
{"lowAmount":0,"highAmount":0,"currency":"IDR","materials":[],"durationHint":"...","assumptions":[],"confidence":0-1}
Description: ${input.description}
Price book: ${JSON.stringify(input.priceBook ?? [])}`;
    try {
      const { data, usageUnits } =
        await this.generateJson<RepairEstimate>(prompt);
      return this.wrap(
        {
          lowAmount: data.lowAmount ?? 0,
          highAmount: data.highAmount ?? 0,
          currency: 'IDR',
          materials: data.materials,
          durationHint: data.durationHint,
          assumptions: data.assumptions,
          confidence: data.confidence ?? 0.3,
        },
        {},
        usageUnits,
      );
    } catch {
      return this.wrap({
        lowAmount: 0,
        highAmount: 0,
        currency: 'IDR',
        confidence: 0,
        assumptions: ['Estimate unavailable'],
      });
    }
  }

  async summarizeFinance(input: {
    period: string;
    propertyScope: string;
    metrics: Record<string, number | string>;
  }): Promise<AiStructuredResult<{ summary: string; insights: string[] }>> {
    const prompt = `Summarize boarding house finance in Indonesian. Use ONLY provided metrics, do not invent numbers.
JSON: {"summary":"...","insights":["..."]}
Period: ${input.period}
Scope: ${input.propertyScope}
Metrics: ${JSON.stringify(input.metrics)}`;
    try {
      const { data, usageUnits } = await this.generateJson<{
        summary: string;
        insights: string[];
      }>(prompt);
      return this.wrap(
        {
          summary: data.summary ?? `Ringkasan ${input.period}`,
          insights: data.insights ?? [],
        },
        {},
        usageUnits,
      );
    } catch {
      return this.wrap({
        summary: `Ringkasan ${input.period}`,
        insights: Object.entries(input.metrics).map(
          ([k, v]) => `${k}: ${String(v)}`,
        ),
      });
    }
  }

  async nlToSearchDsl(input: {
    query: string;
    allowedEntities: string[];
  }): Promise<AiStructuredResult<SearchDsl>> {
    const prompt = `Convert Indonesian natural language to search DSL JSON only:
{"entity":"one of ${input.allowedEntities.join('|')}","filters":{},"sort":[{"field":"...","direction":"asc|desc"}],"limit":50}
Never SQL. Query: ${input.query}`;
    try {
      const { data, usageUnits } = await this.generateJson<SearchDsl>(prompt);
      if (!input.allowedEntities.includes(data.entity)) {
        data.entity = input.allowedEntities[0] ?? 'tenants';
      }
      return this.wrap(data, {}, usageUnits);
    } catch {
      return this.wrap({
        entity: input.allowedEntities[0] ?? 'tenants',
        filters: { _rawQuery: input.query },
        limit: 50,
      });
    }
  }

  async mapSpreadsheetColumns(input: {
    headers: string[];
    sampleRows: string[][];
    targetFields: string[];
  }): Promise<AiStructuredResult<{ mapping: Record<string, string | null> }>> {
    const prompt = `Map spreadsheet headers to target fields. JSON:
{"mapping":{"targetField":"header or null"}}
Headers: ${JSON.stringify(input.headers)}
Targets: ${JSON.stringify(input.targetFields)}
Samples: ${JSON.stringify(input.sampleRows.slice(0, 3))}`;
    try {
      const { data, usageUnits } = await this.generateJson<{
        mapping: Record<string, string | null>;
      }>(prompt);
      return this.wrap(data, {}, usageUnits);
    } catch {
      const mapping: Record<string, string | null> = {};
      for (const field of input.targetFields) {
        const hit = input.headers.find(
          (h) => h.toLowerCase() === field.toLowerCase(),
        );
        mapping[field] = hit ?? null;
      }
      return this.wrap({ mapping });
    }
  }

  async recommendRent(input: {
    currentRent: number;
    occupancyRate: number;
    vacantDays: number;
    roomType: string;
    facilities: string[];
  }): Promise<
    AiStructuredResult<{
      low: number;
      high: number;
      action: 'keep' | 'increase' | 'decrease';
      rationale: string;
    }>
  > {
    const prompt = `Recommend rent IDR for Indonesian kos. JSON:
{"low":0,"high":0,"action":"keep|increase|decrease","rationale":"..."}
Input: ${JSON.stringify(input)}
No auto-price; advisory only.`;
    try {
      const { data, usageUnits } = await this.generateJson<{
        low: number;
        high: number;
        action: 'keep' | 'increase' | 'decrease';
        rationale: string;
      }>(prompt);
      return this.wrap(
        {
          low: data.low ?? input.currentRent,
          high: data.high ?? input.currentRent,
          action: data.action ?? 'keep',
          rationale: data.rationale ?? 'Insufficient data',
        },
        {},
        usageUnits,
      );
    } catch {
      return this.wrap({
        low: input.currentRent,
        high: input.currentRent,
        action: 'keep',
        rationale: 'Recommendation unavailable',
      });
    }
  }
}
