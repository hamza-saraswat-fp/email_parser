import { useLocation, navigate } from "@/lib/router";
import { RunsPage } from "@/pages/RunsPage";
import { RunDetailPage } from "@/pages/RunDetailPage";

export default function App() {
  const { pathname } = useLocation();
  const runMatch = pathname.match(/^\/runs\/([0-9a-f-]+)$/i);
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/")} className="text-base font-semibold tracking-tight">
            Email Parser
          </button>
          <span className="text-sm text-slate-500">portal emails to FieldPulse records</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {runMatch ? <RunDetailPage id={runMatch[1]} /> : <RunsPage />}
      </main>
    </div>
  );
}
