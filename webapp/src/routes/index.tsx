import { createFileRoute } from "@tanstack/react-router";
import { appName } from "~/core/domain/placeholder";

export const Route = createFileRoute("/")({ component: Home });

// Walking-skeleton page. The real sessions/accounts UI arrives in #16.
function Home() {
  return (
    <main>
      <h1>{appName}</h1>
      <p>Web-manager rewrite — scaffold is live.</p>
    </main>
  );
}
