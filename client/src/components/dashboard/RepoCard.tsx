import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { Repository } from "../../types";

type RepoStatus = "safe" | "warning" | "critical" | "scanning";

interface RepoCardProps {
  repo: Repository;
  onScan: (repoId: number) => void;
  onDelete: (repo: Repository) => void;
  selectMode: boolean;
  selected: boolean;
  onSelectToggle: (repoId: number) => void;
  isRemoving?: boolean;
}

const getRepoStatus = (repo: Repository): RepoStatus => {
  const repoStatus = repo.status.toLowerCase();
  const hasScanningBranch = repo.branches.some(
    (branch) => branch.scanStatus === "scanning" || branch.scanStatus === "pending"
  );

  if (repoStatus.includes("critical")) {
    return "critical";
  }

  if (repoStatus.includes("conflict")) {
    return "warning";
  }

  if (repoStatus.includes("scanning") || hasScanningBranch) {
    return "scanning";
  }

  return "safe";
};

const formatLastScanned = (value?: string) => {
  if (!value) {
    return "N/A";
  }

  const scannedAt = new Date(value);
  const minutesAgo = Math.floor((Date.now() - scannedAt.getTime()) / (1000 * 60));

  if (Number.isNaN(minutesAgo) || minutesAgo < 0) {
    return "N/A";
  }

  if (minutesAgo < 60) {
    return `${minutesAgo}m ago`;
  }

  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) {
    return `${hoursAgo}h ago`;
  }

  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo}d ago`;
};

const RepoCard = ({
  repo,
  onScan,
  onDelete,
  selectMode,
  selected,
  onSelectToggle,
  isRemoving = false,
}: RepoCardProps) => {
  const status = getRepoStatus(repo);
  const totalApis = useMemo(
    () => repo.totalApis || repo.branches.reduce((sum, branch) => sum + (branch.totalApis ?? 0), 0),
    [repo]
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const statusMap: Record<RepoStatus, { text: string; className: string; icon: string }> = {
    safe: {
      text: "No conflicts",
      className: "text-green-400",
      icon: "✅",
    },
    warning: {
      text: "Conflicts detected",
      className: "text-yellow-400",
      icon: "⚠️",
    },
    critical: {
      text: "Critical conflicts",
      className: "text-red-400",
      icon: "🔴",
    },
    scanning: {
      text: "Scanning in progress",
      className: "text-blue-400",
      icon: "🔄",
    },
  };

  return (
    <article
      className={`card border-slate-700/70 transition-all duration-300 ${
        isRemoving ? "max-h-0 -translate-x-4 overflow-hidden p-0 opacity-0" : "max-h-[420px] opacity-100"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {selectMode ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelectToggle(repo.id)}
              className="h-4 w-4 cursor-pointer rounded border-slate-600 bg-dark-900 text-brand-600"
              aria-label={`Select ${repo.name}`}
            />
          ) : null}
          <h3 className="truncate text-base font-semibold text-white">📁 {repo.name}</h3>
        </div>

        <div className="relative flex items-center gap-2" ref={menuRef}>
          <button type="button" onClick={() => onScan(repo.id)} className="btn-secondary text-sm">
            Scan
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="Repo actions"
          >
            •••
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-11 z-20 w-56 rounded-lg border border-slate-700 bg-dark-900 p-1 shadow-xl">
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                onClick={() => {
                  setMenuOpen(false);
                  onScan(repo.id);
                }}
              >
                🔄 Scan Now
              </button>
              <Link
                to={`/repo/${repo.id}`}
                className="block rounded-md px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                onClick={() => setMenuOpen(false)}
              >
                📋 View Details
              </Link>
              <div className="my-1 h-px bg-slate-700" />
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-400 transition hover:bg-red-500/10"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(repo);
                }}
              >
                🗑️ Remove from ContractGuard
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <p className="truncate text-sm text-slate-400">{repo.githubUrl}</p>
      <p className="mt-1 text-sm text-slate-300">{repo.language || "Unknown"}</p>

      <div className="my-3 h-px bg-slate-700/70" />

      <div className="grid grid-cols-3 gap-2 text-xs text-slate-300 sm:text-sm">
        <span>{repo.branches.length} branches</span>
        <span>{totalApis} APIs</span>
        <span>Last: {formatLastScanned(repo.lastScanned)}</span>
      </div>

      <div className="my-3 h-px bg-slate-700/70" />

      <div className="flex items-center justify-between">
        <p className={`text-sm font-medium ${statusMap[status].className}`}>
          {statusMap[status].icon} {statusMap[status].text}
        </p>
        <Link to={`/repo/${repo.id}`} className="text-sm font-medium text-brand-500 hover:text-brand-100">
          View →
        </Link>
      </div>
    </article>
  );
};

export default RepoCard;
