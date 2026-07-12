// Provider Type catalogue — the code-defined source of truth for the kinds of
// AI provider a Session can run on (#5 resolution, PRD §3). Adding a future
// curated provider (GLM, Kimi, ...) is a new entry here, never code surgery in
// the use cases: capabilities (remoteControl, seeding) are read from the
// catalogue, so behaviour follows data.

import { UnknownProviderTypeError } from "./errors";

export type SeedingMethod = "api-key" | "oauth";

/** Where a registered field value is stored on the Account. */
export type FieldStore = "credentials" | "config";

export type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  store: FieldStore;
};

export type ProviderType = {
  id: string;
  label: string;
  seeding: SeedingMethod;
  /** claude: true; deepseek, custom: false. */
  remoteControl: boolean;
  /** What an Account of this type must supply at registration. */
  accountFields: FieldSpec[];
  /** Curated api-key entries (deepseek) ship a baseUrl/model preset. */
  presets?: { baseUrl?: string; model?: string };
};

const CATALOGUE: ProviderType[] = [
  {
    id: "claude",
    label: "Claude",
    seeding: "oauth",
    remoteControl: true,
    accountFields: [],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    seeding: "api-key",
    remoteControl: false,
    accountFields: [
      { name: "apiKey", label: "API Key", type: "password", required: true, store: "credentials" },
    ],
    presets: { baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-chat" },
  },
  {
    id: "custom",
    label: "Custom",
    seeding: "api-key",
    remoteControl: false,
    accountFields: [
      { name: "apiKey", label: "API Key", type: "password", required: true, store: "credentials" },
      { name: "baseUrl", label: "Base URL", type: "url", required: true, store: "config" },
      { name: "model", label: "Model", type: "text", required: true, store: "config" },
    ],
  },
];

export function listProviderTypes(): ProviderType[] {
  return CATALOGUE;
}

export function findProviderType(id: string): ProviderType | undefined {
  return CATALOGUE.find((t) => t.id === id);
}

export function requireProviderType(id: string): ProviderType {
  const t = findProviderType(id);
  if (!t) throw new UnknownProviderTypeError(id);
  return t;
}

export function requiredAccountFields(type: ProviderType): FieldSpec[] {
  return type.accountFields.filter((f) => f.required);
}
