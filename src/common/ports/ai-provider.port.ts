export const AI_PROVIDER_PORT = Symbol('AI_PROVIDER_PORT');

export type AiConfidence = Record<string, number>;

export interface AiStructuredResult<T> {
  data: T;
  confidence: AiConfidence;
  model: string;
  usageUnits?: number;
  raw?: unknown;
}

export interface PaymentProofExtraction {
  bank?: string;
  senderName?: string;
  recipientName?: string;
  amount?: number;
  transactionAt?: string;
  referenceNumber?: string;
}

export interface IdentityExtraction {
  nik?: string;
  fullName?: string;
  name?: string;
  birthPlace?: string;
  birthDate?: string;
  dateOfBirth?: string;
  address?: string;
  alamat?: string;
  gender?: string;
  jenisKelamin?: string;
  maritalStatus?: string;
  phone?: string;
  email?: string;
}

export interface ExpenseCategorization {
  categories: Array<{ key: string; label: string; confidence: number }>;
  suggestedVendor?: string;
  recurring?: boolean;
}

export interface CommunicationDraft {
  subject?: string;
  body: string;
  tone: string;
}

export interface MaintenanceTriage {
  category?: string;
  urgency?: string;
  hazards?: string[];
  recommendedSkill?: string;
  checklist?: string[];
  safetyInstructions?: string[];
}

export interface DamageAnalysis {
  observations: string[];
  affectedAreas?: string[];
  severitySuggestion?: string;
  uncertaintyNotes?: string[];
}

export interface RepairEstimate {
  lowAmount: number;
  highAmount: number;
  currency: string;
  materials?: string[];
  durationHint?: string;
  assumptions?: string[];
  confidence: number;
}

export interface SearchDsl {
  entity: string;
  filters: Record<string, unknown>;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
}

export interface AiProviderPort {
  extractPaymentProof(input: {
    imageUrl?: string;
    base64?: string;
    mimeType?: string;
  }): Promise<AiStructuredResult<PaymentProofExtraction>>;

  extractIdentity(input: {
    imageUrl?: string;
    base64?: string;
    mimeType?: string;
  }): Promise<AiStructuredResult<IdentityExtraction>>;

  categorizeExpense(input: {
    description: string;
    vendor?: string;
    amount?: number;
    propertyName?: string;
  }): Promise<AiStructuredResult<ExpenseCategorization>>;

  draftCommunication(input: {
    purpose: string;
    audience: string;
    context: Record<string, unknown>;
    tone: string;
    channel: string;
  }): Promise<AiStructuredResult<CommunicationDraft>>;

  triageMaintenance(input: {
    description: string;
    categoryHint?: string;
  }): Promise<AiStructuredResult<MaintenanceTriage>>;

  analyzeDamage(input: {
    imageUrls: string[];
    description?: string;
  }): Promise<AiStructuredResult<DamageAnalysis>>;

  estimateRepair(input: {
    description: string;
    imageUrls?: string[];
    priceBook?: Array<{ name: string; unitPrice: number }>;
  }): Promise<AiStructuredResult<RepairEstimate>>;

  summarizeFinance(input: {
    period: string;
    propertyScope: string;
    metrics: Record<string, number | string>;
  }): Promise<AiStructuredResult<{ summary: string; insights: string[] }>>;

  nlToSearchDsl(input: {
    query: string;
    allowedEntities: string[];
  }): Promise<AiStructuredResult<SearchDsl>>;

  mapSpreadsheetColumns(input: {
    headers: string[];
    sampleRows: string[][];
    targetFields: string[];
  }): Promise<
    AiStructuredResult<{ mapping: Record<string, string | null> }>
  >;

  recommendRent(input: {
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
  >;
}
