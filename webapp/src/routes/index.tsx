import { createFileRoute } from "@tanstack/react-router";
import { listProviderTypes } from "~/core";

export const Route = createFileRoute("/")({ component: Home });

// Walking-skeleton page. The real sessions/accounts UI arrives in #16.
function Home() {
  const providerTypes = listProviderTypes();
  return (
    <main>
      <h1>cc-remote</h1>
      <p>Web-manager rewrite — {providerTypes.length} provider types available.</p>
    </main>
  );
}
