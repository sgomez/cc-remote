// Settings — Deployment Settings, editable from the browser so a two-position
// switch does not need SSH and a redeploy. It ships with exactly one setting in
// it: the default Permission Mode the create-Session form starts from. It is the
// seat for later Deployment Settings (idle shutdown, preinstalled plugins), but
// it promises nothing it does not deliver today.
//
// The stored value is the ONLY source: nothing in the environment supplies or
// overrides it, so there is no precedence to explain to the operator.

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { fetchSettings, updateSettings } from "~/server/settings";
import { useFeedback } from "~/ui/components/feedback";
import { permissionModeOptions, prefilledPermissionMode } from "~/ui/view-models/permission-mode";

export const Route = createFileRoute("/_app/settings/")({
  loader: async () => ({ settings: await fetchSettings() }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings } = Route.useLoaderData();
  const router = useRouter();
  const { toast } = useFeedback();

  const [mode, setMode] = useState(() => prefilledPermissionMode(settings.defaultPermissionMode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = mode !== settings.defaultPermissionMode;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ data: { defaultPermissionMode: mode } });
      toast.success("Default permission mode saved.");
      await router.invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/</span>settings
          </h1>
          <p className="subtle">Deployment preferences. No redeploy needed.</p>
        </div>
      </div>

      <div className="panel narrow">
        <div className="field">
          <span className="field-label">Default permission mode</span>
          <p className="hint">
            What the create-session form starts from. It does not change any session that already
            exists: it applies only to sessions you create or reset from now on.
          </p>
          <div className="card-list">
            {permissionModeOptions().map((o) => (
              <label
                key={o.value}
                className={`card radio-card${mode === o.value ? " selected" : ""}`}
              >
                <div className="card-row">
                  <input
                    type="radio"
                    name="default-permission-mode"
                    checked={mode === o.value}
                    onChange={() => setMode(o.value)}
                  />
                  <span className="card-title">{o.label}</span>
                </div>
                <div className="hint">{o.description}</div>
                {o.notice && mode === o.value && <div className="hint subtle">{o.notice}</div>}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="actions">
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
