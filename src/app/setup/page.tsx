import { SetupPage, setupMetadata } from "./guide";

// The generic setup guide, for any agent: the registration step carries the table of agent kinds.
// Per-agent versions live at /setup/<agent id>.

export const metadata = setupMetadata(undefined);

export default function GenericSetupPage() {
  return <SetupPage agent={undefined} />;
}
