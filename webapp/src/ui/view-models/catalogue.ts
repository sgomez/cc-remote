// Pure view models for the /accounts/new two-step flow (#16): the catalogue
// type-picker cards (with the claude-local singleton disabled once one exists)
// and the per-type registration form spec (the account-name field plus the
// Provider Type's own accountFields, presets, and the OAuth Login-Container
// notice). Framework-free; the form component only renders what this returns.

import type { FieldSpec, ProviderType } from "~/core";
import { type AccountCapabilities, accountCapabilities } from "./capabilities";

export type CatalogueCard = AccountCapabilities & {
  id: string;
  label: string;
  /** Disabled when a singleton type already has its one Account. */
  disabled: boolean;
  /** Shown on the card when disabled (else undefined). */
  disabledReason?: string;
  seeding: ProviderType["seeding"];
};

/**
 * Catalogue cards for the type picker. A singleton Provider Type (claude-local)
 * is disabled — with an "already attached" reason — once an Account of it
 * exists, matching the deployment rule that it is optional and at most one.
 */
export function catalogueCards(
  types: ProviderType[],
  accounts: ReadonlyArray<{ providerType: string }>,
): CatalogueCard[] {
  return types.map((type) => {
    const taken = type.singleton && accounts.some((a) => a.providerType === type.id);
    return {
      ...accountCapabilities(type),
      id: type.id,
      label: type.label,
      seeding: type.seeding,
      disabled: taken,
      disabledReason: taken ? "already attached" : undefined,
    };
  });
}

/** The always-present account-name field, kept separate from the domain's accountFields. */
export const ACCOUNT_NAME_FIELD: FieldSpec = {
  name: "displayName",
  label: "Account name",
  type: "text",
  required: true,
  store: "config",
};

export type AccountFormSpec = {
  typeId: string;
  label: string;
  /** Name field first, then the Provider Type's own fields (apiKey, baseUrl, ...). */
  fields: FieldSpec[];
  /** Curated presets (deepseek) shown read-only under the form, if any. */
  presets?: { baseUrl?: string; model?: string };
  /** Whether registration continues into a Login Container (oauth types). */
  oauthNotice: boolean;
  /** claude-local has no fields at all beyond the (fixed) name. */
  hostMount: boolean;
};

export function accountFormSpec(type: ProviderType): AccountFormSpec {
  return {
    typeId: type.id,
    label: type.label,
    fields: [ACCOUNT_NAME_FIELD, ...type.accountFields],
    presets: type.presets,
    oauthNotice: type.seeding === "oauth",
    hostMount: type.seeding === "host-mount",
  };
}

/**
 * Whether the form's submit is enabled: every required field (including the
 * account name) has a non-blank value. host-mount types (no fields) are always
 * complete once the fixed name is supplied.
 */
export function accountFormComplete(
  spec: AccountFormSpec,
  values: Record<string, string>,
): boolean {
  return spec.fields.every((f) => !f.required || (values[f.name] ?? "").trim() !== "");
}
