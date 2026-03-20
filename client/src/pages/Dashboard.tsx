import { useEffect, useMemo, useState } from "react";

import RepoCard from "../components/dashboard/RepoCard";
import DeleteConfirmModal from "../components/ui/DeleteConfirmModal";
import { useRepoStore } from "../store/repoStore";
import type { Repository } from "../types";

type RepoStatus = "safe" | "warning" | "critical" | "scanning";

interface StatCardProps {
  label: string;
  value: number;
  icon: string;
  iconClassName: string;
  pulse?: boolean;
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

function StatCard({ label, value, icon, iconClassName, pulse = false }: StatCardProps) {
  return (
    <div className="card border-slate-700/60">
      <div className="mb-4 flex items-start justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconClassName} ${
            pulse ? "animate-pulse" : ""
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}

interface RepoListProps {
  repos: Repository[];
  onScan: (repoId: number) => void;
  onDelete: (repo: Repository) => void;
  onAdd: () => void;
  selectMode: boolean;
  selectedIds: number[];
  onSelectToggle: (repoId: number) => void;
  removingIds: number[];
}

function RepoList({
  repos,
  onScan,
  onDelete,
  onAdd,
  selectMode,
  selectedIds,
  onSelectToggle,
  removingIds,
}: RepoListProps) {
  if (repos.length === 0) {
    return (
      <div className="card border-dashed border-slate-700 text-center">
        <p className="text-3xl">📭</p>
        <p className="mt-2 text-lg font-medium text-white">No repositories yet</p>
        <p className="mt-1 text-sm text-slate-400">Add your first GitHub repository to start tracking API conflicts.</p>
        <div className="mt-4">
          <button type="button" className="btn-primary" onClick={onAdd}>
            + Add Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {repos.map((repo) => (
        <RepoCard
          key={repo.id}
          repo={repo}
          onScan={onScan}
          onDelete={onDelete}
          selectMode={selectMode}
          selected={selectedIds.includes(repo.id)}
          onSelectToggle={onSelectToggle}
          isRemoving={removingIds.includes(repo.id)}
        />
      ))}
    </div>
  );
}

function Dashboard() {
  const { repos, loading, error, fetchRepos, addRepo, scanRepo, deleteRepo } = useRepoStore();

  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [repoToDelete, setRepoToDelete] = useState<Repository | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<number[]>([]);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  const filteredRepos = useMemo(() => {
    const keyword = search.toLowerCase().trim();
    if (!keyword) {
      return repos;
    }

    return repos.filter((repo) => {
      const haystack = `${repo.name} ${repo.fullName} ${repo.githubUrl} ${repo.language || ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [repos, search]);

  const totalBranches = useMemo(
    () => repos.reduce((sum, repo) => sum + repo.branches.length, 0),
    [repos]
  );

  const totalApis = useMemo(
    () =>
      repos.reduce(
        (sum, repo) =>
          sum + (repo.totalApis || repo.branches.reduce((inner, branch) => inner + (branch.totalApis ?? 0), 0)),
        0
      ),
    [repos]
  );

  const activeConflicts = useMemo(
    () => repos.filter((repo) => {
      const status = getRepoStatus(repo);
      return status === "warning" || status === "critical";
    }).length,
    [repos]
  );

  const validateUrl = (url: string) => {
    const isValid = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(url.trim());
    return isValid;
  };

  const handleUrlChange = (value: string) => {
    setGithubUrl(value);
    if (!value) {
      setUrlError(null);
      return;
    }

    setUrlError(validateUrl(value) ? null : "Invalid GitHub repository URL");
  };

  const handleAddRepository = async () => {
    if (!validateUrl(githubUrl)) {
      setUrlError("Invalid GitHub repository URL");
      return;
    }

    setIsSubmitting(true);
    await addRepo(githubUrl.trim());
    setIsSubmitting(false);

    if (!useRepoStore.getState().error) {
      setGithubUrl("");
      setUrlError(null);
      setIsModalOpen(false);
    }
  };

  const handleScan = async (repoId: number) => {
    await scanRepo(repoId);
    await fetchRepos();
  };

  const handleSingleDelete = async () => {
    if (!repoToDelete) {
      return;
    }

    setIsDeleting(true);
    setRemovingIds((current) => (current.includes(repoToDelete.id) ? current : [...current, repoToDelete.id]));
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 260);
    });
    const summary = await deleteRepo(repoToDelete.id);
    setIsDeleting(false);

    if (!summary) {
      setRemovingIds((current) => current.filter((repoId) => repoId !== repoToDelete.id));
      return;
    }

    setRepoToDelete(null);
    setRemovingIds((current) => current.filter((repoId) => repoId !== repoToDelete.id));
    setToast(`✅ ${summary.repo} removed from ContractGuard. Your GitHub repository is untouched.`);
    setSelectedRepoIds((current) => current.filter((repoId) => repoId !== repoToDelete.id));
  };

  const toggleSelectRepo = (repoId: number) => {
    setSelectedRepoIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId]
    );
  };

  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectedRepoIds([]);
      setShowBulkConfirm(false);
    }
    setSelectMode((current) => !current);
  };

  const handleBulkDelete = async () => {
    if (selectedRepoIds.length === 0) {
      return;
    }

    const ids = [...selectedRepoIds];
    let removed = 0;

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      setBulkProgress(`Removing ${index + 1} of ${ids.length}...`);
      setRemovingIds((current) => (current.includes(id) ? current : [...current, id]));
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 240);
      });
      const summary = await deleteRepo(id);
      if (summary) {
        removed += 1;
      }
      setRemovingIds((current) => current.filter((repoId) => repoId !== id));
    }

    setBulkProgress(null);
    setShowBulkConfirm(false);
    setSelectedRepoIds([]);
    setSelectMode(false);
    setToast(`✅ ${removed} ${removed === 1 ? "repository" : "repositories"} removed`);
  };

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card animate-pulse border-slate-700/60">
              <div className="h-4 w-24 rounded bg-slate-700" />
              <div className="mt-4 h-8 w-16 rounded bg-slate-700" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total Repositories"
              value={repos.length}
              icon="📦"
              iconClassName="bg-blue-500/20 text-blue-300"
            />
            <StatCard
              label="Total Branches"
              value={totalBranches}
              icon="🌿"
              iconClassName="bg-purple-500/20 text-purple-300"
            />
            <StatCard
              label="Total APIs Detected"
              value={totalApis}
              icon="🧩"
              iconClassName="bg-green-500/20 text-green-300"
            />
            <StatCard
              label="Active Conflicts"
              value={activeConflicts}
              icon="⚠️"
              iconClassName="bg-red-500/20 text-red-300"
              pulse={activeConflicts > 0}
            />
          </>
        )}
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold text-white">Repositories</h2>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search repositories..."
              className="rounded-lg border border-slate-700 bg-dark-900 px-3 py-2 text-sm text-white outline-none ring-brand-500 transition focus:ring-1"
            />
            <button type="button" className="btn-secondary" onClick={toggleSelectMode}>
              {selectMode ? "Cancel" : "Select"}
            </button>
            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              + Add Repository
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="card animate-pulse border-slate-700/70">
                <div className="h-5 w-2/3 rounded bg-slate-700" />
                <div className="mt-3 h-4 w-full rounded bg-slate-700" />
                <div className="mt-2 h-4 w-1/2 rounded bg-slate-700" />
                <div className="mt-4 h-px bg-slate-700/70" />
                <div className="mt-3 h-4 w-full rounded bg-slate-700" />
              </div>
            ))}
          </div>
        ) : (
          <RepoList
            repos={filteredRepos}
            onScan={handleScan}
            onDelete={setRepoToDelete}
            onAdd={() => setIsModalOpen(true)}
            selectMode={selectMode}
            selectedIds={selectedRepoIds}
            onSelectToggle={toggleSelectRepo}
            removingIds={removingIds}
          />
        )}

        {selectMode && selectedRepoIds.length > 0 ? (
          <div className="fixed bottom-4 left-1/2 z-40 w-[min(720px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-slate-700 bg-dark-800 px-4 py-3 shadow-2xl">
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="text-white">☑️ {selectedRepoIds.length} repositories selected</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSelectedRepoIds([]);
                    setSelectMode(false);
                  }}
                >
                  Cancel Selection
                </button>
                <button type="button" className="rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600" onClick={() => setShowBulkConfirm(true)}>
                  🗑️ Remove Selected
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white">Add Repository</h3>
            <p className="mt-1 text-sm text-slate-400">GitHub Repository URL</p>

            <input
              type="url"
              value={githubUrl}
              onChange={(event) => handleUrlChange(event.target.value)}
              placeholder="https://github.com/owner/repo"
              className="mt-3 w-full rounded-lg border border-slate-700 bg-dark-900 px-3 py-2 text-sm text-white outline-none ring-brand-500 transition focus:ring-1"
            />

            {(urlError || error) && (
              <p className="mt-2 text-sm text-red-400">{urlError || error || "Repo not found"}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setIsModalOpen(false);
                  setGithubUrl("");
                  setUrlError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleAddRepository}
                disabled={isSubmitting || !!urlError || !githubUrl.trim()}
              >
                {isSubmitting ? "Adding..." : "Add Repository"}
              </button>
            </div>
          </div>
        </div>
      )}

      {repoToDelete ? (
        <DeleteConfirmModal
          repo={repoToDelete}
          onCancel={() => {
            if (!isDeleting) {
              setRepoToDelete(null);
            }
          }}
          onConfirm={handleSingleDelete}
          isDeleting={isDeleting}
        />
      ) : null}

      {showBulkConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-dark-800 p-5">
            <h3 className="text-lg font-semibold text-white">Remove {selectedRepoIds.length} repositories from ContractGuard?</h3>
            <p className="mt-2 text-sm text-slate-300">This will delete all their scanned data.</p>
            {bulkProgress ? <p className="mt-3 text-sm text-brand-400">{bulkProgress}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowBulkConfirm(false)} disabled={!!bulkProgress}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                onClick={handleBulkDelete}
                disabled={!!bulkProgress}
              >
                Remove All
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-green-500/30 bg-dark-800 px-4 py-3 text-sm text-green-400 shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default Dashboard;