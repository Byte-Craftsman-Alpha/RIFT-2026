import Dashboard from "@/components/Dashboard";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 font-sans text-zinc-900">
      <main className="w-full max-w-6xl rounded-2xl bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-2 border-b border-zinc-100 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Financial Forensics Engine</h1>
          <p className="text-sm text-zinc-600">
            Upload a transaction CSV to detect circular routing, smurfing, and layered shell networks.
          </p>
        </header>

        <div className="py-6">
          <Dashboard />
        </div>
      </main>
    </div>
  );
}
