import { useLocation } from "react-router-dom";

const getTitle = (pathname: string) => {
  if (pathname.startsWith("/repo/")) {
    return "Repository";
  }

  if (pathname.startsWith("/conflicts/")) {
    return "Conflicts";
  }

  if (pathname.startsWith("/result/")) {
    return "Result";
  }

  return "Dashboard";
};

function Header() {
  const location = useLocation();
  const title = getTitle(location.pathname);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-800 bg-dark-900/95 px-6 backdrop-blur">
      <h2 className="text-xl font-semibold text-white">{title}</h2>

      <div className="flex items-center gap-3">
        <span className="rounded-full border border-green-500/30 bg-green-500/20 px-3 py-1 text-xs font-medium text-green-300">
          GitHub Connected
        </span>
        <button
          type="button"
          className="rounded-lg border border-slate-700 bg-dark-800 px-3 py-1.5 text-sm text-slate-200 transition-all duration-200 hover:border-slate-500 hover:text-white"
          aria-label="Notifications"
        >
          🔔
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-700 bg-dark-800 px-3 py-1.5 text-sm text-slate-200 transition-all duration-200 hover:border-slate-500 hover:text-white"
        >
          ↻ Refresh
        </button>
      </div>
    </header>
  );
}

export default Header;