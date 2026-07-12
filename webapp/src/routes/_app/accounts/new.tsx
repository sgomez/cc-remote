// New-account two-step flow on one route (#16). Step 1 (?type absent) is the
// catalogue type-picker — capability cards, with the claude-local singleton
// disabled once one exists. Step 2 (?type=<id>) renders that type's form: the
// account name plus the Provider Type's own fields, deepseek presets shown
// read-only, and an OAuth notice for `claude`. The step change is a router
// navigation, so it animates as a View Transition. On submit the register-account
// use case runs server-side; oauth accounts land on their detail page (Login
// Container), the rest on the accounts list.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { listProviderTypes, requireProviderType } from "~/core";
import { listAccounts, registerAccount } from "~/server/accounts";
import { Capability } from "~/ui/components/badges";
import { accountFormComplete, accountFormSpec, catalogueCards } from "~/ui/view-models/catalogue";

export const Route = createFileRoute("/_app/accounts/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  loader: async () => ({ accounts: await listAccounts() }),
  component: NewAccountPage,
});

function NewAccountPage() {
  const { type } = Route.useSearch();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/accounts/</span>new
          </h1>
          <p className="subtle">Register a provider account.</p>
        </div>
        <Link to="/accounts" className="btn">
          ← back
        </Link>
      </div>

      <div className="steps">
        <span className={`step ${!type ? "on" : ""}`}>1 · provider type</span>
        <span className="sep">──</span>
        <span className={`step ${type ? "on" : ""}`}>2 · account details</span>
      </div>

      {type ? <TypeForm typeId={type} /> : <TypePicker />}
    </>
  );
}

function TypePicker() {
  const { accounts } = Route.useLoaderData();
  const router = useRouter();
  const cards = catalogueCards(listProviderTypes(), accounts);

  return (
    <div className="type-grid">
      {cards.map((c) => (
        <button
          type="button"
          key={c.id}
          className="type-card"
          disabled={c.disabled}
          onClick={() => router.navigate({ to: "/accounts/new", search: { type: c.id } })}
        >
          <h3>{c.label}</h3>
          <div className="caps">
            <Capability on={c.remoteControl} label="remote control" />
            <span className="badge cap">seeding: {c.seedingLabel}</span>
            {c.singleton && (
              <span className="badge cap">{c.disabled ? c.disabledReason : "singleton"}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function TypeForm({ typeId }: { typeId: string }) {
  const type = requireProviderType(typeId);
  const spec = accountFormSpec(type);
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }));
  const complete = accountFormComplete(spec, values);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { displayName, ...fields } = values;
      const res = await registerAccount({
        data: { providerType: type.id, displayName: displayName ?? "", fields },
      });
      router.navigate(
        res.oauth
          ? { to: "/accounts/$accountId", params: { accountId: res.id } }
          : { to: "/accounts" },
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>{type.label}</h2>

      {spec.hostMount && (
        <p className="subtle" style={{ marginBottom: 12 }}>
          Attaches the host's <code className="inline">~/.claude</code> +{" "}
          <code className="inline">~/.claude.json</code> as the singleton account — no credentials
          to enter.
        </p>
      )}

      {spec.fields.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={`field-${f.name}`}>{f.label}</label>
          <input
            id={`field-${f.name}`}
            type={f.type === "password" ? "password" : "text"}
            value={values[f.name] ?? ""}
            onChange={(e) => set(f.name, e.target.value)}
          />
        </div>
      ))}

      {spec.presets && (
        <p className="hint">
          curated presets: base URL <span className="preset">{spec.presets.baseUrl}</span> · model{" "}
          <span className="preset">{spec.presets.model}</span>
        </p>
      )}

      {spec.oauthNotice && (
        <div className="panel warn" style={{ marginTop: 12 }}>
          <strong className="warn-text">Next step: Login Container.</strong>
          <p className="subtle" style={{ margin: "6px 0 0" }}>
            After creating the account you will complete <code className="inline">claude</code>{" "}
            login in an ephemeral container's web terminal. The account stays{" "}
            <code className="inline">pending_login</code> until credentials appear in its config
            volume.
          </p>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="actions">
        <button type="button" className="btn primary" disabled={!complete || busy} onClick={create}>
          {busy
            ? "creating…"
            : spec.oauthNotice
              ? "create & open login container"
              : spec.hostMount
                ? "attach host config"
                : "create account"}
        </button>
        <Link to="/accounts/new" search={{ type: undefined }} className="btn">
          change type
        </Link>
      </div>
    </div>
  );
}
