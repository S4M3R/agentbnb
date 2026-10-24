export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">AgentBnB</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Your personal agent for finding a couch, anywhere. It searches every
        couch-surfing marketplace plus our own network of hosts.
      </p>
    </main>
  );
}
