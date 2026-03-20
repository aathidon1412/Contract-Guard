import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useAIStatus } from "../../hooks/useAIStatus";

const SIDEBAR_WIDTH_CLASS = "w-[240px]";

function Sidebar() {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const activeSessionId = useMemo(
    () => localStorage.getItem("activeSessionId") || "active",
    []
  );

  const activeResultId = useMemo(
    () => localStorage.getItem("activeResultId") || activeSessionId,
    [activeSessionId]
  );

  const { available, model, modelLoaded, loading, url, statusMessage, backendReachable } = useAIStatus();

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);

    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);

    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
      isActive
        ? "bg-brand-600/20 text-brand-500"
        : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  const aiDotClass = loading
    ? "bg-slate-400"
    : !available
      ? "bg-red-500"
      : !modelLoaded
        ? "bg-yellow-400"
        : "bg-green-500";

  return (
    <aside className={`fixed left-0 top-0 flex h-screen ${SIDEBAR_WIDTH_CLASS} flex-col border-r border-slate-800 bg-dark-950 px-4 py-5`}>
      <div className="mb-8 flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">
          🛡️
        </span>
        <h1 className="text-lg font-semibold text-white">ContractGuard</h1>
      </div>

      <nav className="flex flex-col gap-2">
        <NavLink to="/" className={navItemClass}>
          🏠 Dashboard
        </NavLink>
        <NavLink to="/" className={navItemClass}>
          📁 Repositories
        </NavLink>
        <NavLink to={`/conflicts/${activeSessionId}`} className={navItemClass}>
          🔍 Conflicts
        </NavLink>
        <NavLink to={`/result/${activeResultId}`} className={navItemClass}>
          ✅ Results
        </NavLink>
      </nav>

      <div className="mt-auto space-y-3">
        <div
          className="rounded-lg border border-slate-800 bg-dark-900 p-3"
          title={`Model: ${model}\nURL: ${url}\nStatus: ${statusMessage}`}
        >
          <p className="mb-2 text-sm font-medium text-slate-200">🤖 AI Engine</p>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-full ${aiDotClass}`} />
            <span>{model}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{statusMessage}</p>
        </div>

        {!available && !loading && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
            {backendReachable
              ? "⚠️ Start Ollama for AI features"
              : "⚠️ API server unavailable — start ContractGuard backend"}
          </div>
        )}

        <div className="rounded-lg border border-slate-800 bg-dark-900 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-slate-300">API Server: {isOnline ? "Online" : "Offline"}</span>
          </div>
          <p className="text-xs text-slate-500">Version: v1.0.0</p>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
