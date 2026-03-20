import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import axiosClient from "../api/axiosClient";
import ScanProgress, { type ScanResult } from "../components/scanning/ScanProgress";
import { useConflictStore } from "../store/conflictStore";
import { useRepoStore } from "../store/repoStore";
import type { ApiEndpoint, Branch, Repository as RepositoryType } from "../types";

interface BranchDetailsResponse extends Branch {
  endpoints: ApiEndpoint[];
  endpointCount?: number;
  conflicts?: number;
}

const formatLastScanned = (value?: string) => {
  if (!value) {
    return "N/A";
  }

  const scannedAt = new Date(value);
  const diffMinutes = Math.floor((Date.now() - scannedAt.getTime()) / (1000 * 60));

  if (Number.isNaN(diffMinutes) || diffMinutes < 0) {
    return "N/A";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hours ago`;
  }

  return `${Math.floor(diffHours / 24)} days ago`;
};

const getBranchStatusLabel = (branch: Branch) => {
  if (branch.scanStatus === "scanning") {
    return "Scanning";
  }
  if (branch.scanStatus === "failed") {
    return "Failed";
  }
  if (branch.scanStatus === "pending") {
    return "Pending";
  }
  return "Ready";
};

const getBranchEndpointCount = (branch: Branch) => {
  const withEndpointCount = branch as Branch & { endpointCount?: number };
  return withEndpointCount.endpointCount ?? branch.totalApis ?? branch.endpoints?.length ?? 0;
};

function Repository() {
  const navigate = useNavigate();
  const { repoId } = useParams();

  const {
    selectedRepo,
    repos,
    loading,
    error,
    fetchRepos,
    fetchBranches,
    selectRepo,
  } = useRepoStore();

  const { startSession, loading: sessionLoading, session } = useConflictStore();

  const [expandedBranchId, setExpandedBranchId] = useState<number | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [scanningBranchIds, setScanningBranchIds] = useState<number[]>([]);
  const [scanQueue, setScanQueue] = useState<number[]>([]);
  const [activeScanIndex, setActiveScanIndex] = useState(0);
  const [scanSessionId, setScanSessionId] = useState(0);
  const [mainBranchId, setMainBranchId] = useState<number | null>(null);
  const [compareBranchIds, setCompareBranchIds] = useState<number[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);

  const numericRepoId = Number(repoId);
  const isRepoIdValid = !Number.isNaN(numericRepoId);

  useEffect(() => {
    if (!isRepoIdValid) {
      return;
    }

    const loadRepository = async () => {
      await fetchRepos();
      await fetchBranches(numericRepoId);

      const latest = useRepoStore
        .getState()
        .repos.find((repo) => repo.id === numericRepoId);

      if (latest) {
        selectRepo(latest);
      }
    };

    void loadRepository();
  }, [fetchBranches, fetchRepos, isRepoIdValid, numericRepoId, selectRepo]);

  const repo = useMemo(() => {
    if (!isRepoIdValid) {
      return null;
    }
    if (selectedRepo?.id === numericRepoId) {
      return selectedRepo;
    }
    return repos.find((item) => item.id === numericRepoId) ?? null;
  }, [isRepoIdValid, numericRepoId, repos, selectedRepo]);

  useEffect(() => {
    if (!repo) {
      return;
    }

    const main = repo.branches.find((branch) => branch.type === "main");
    if (!mainBranchId && main) {
      setMainBranchId(main.id);
    }
  }, [mainBranchId, repo]);

  const expandedBranch = useMemo(
    () => repo?.branches.find((branch) => branch.id === expandedBranchId) ?? null,
    [expandedBranchId, repo]
  );

  const mainBranches = useMemo(
    () => repo?.branches.filter((branch) => branch.type === "main") ?? [],
    [repo]
  );

  const featureBranches = useMemo(
    () => repo?.branches.filter((branch) => branch.type !== "main") ?? [],
    [repo]
  );

  const activeScanBranchId = scanQueue[activeScanIndex] ?? null;
  const activeScanBranch = useMemo(
    () => repo?.branches.find((branch) => branch.id === activeScanBranchId) ?? null,
    [activeScanBranchId, repo]
  );

  const canCompareSelected = useMemo(() => {
    if (!repo || !mainBranchId || compareBranchIds.length === 0) {
      return false;
    }

    const isMainReady = repo.branches.find((branch) => branch.id === mainBranchId)?.scanStatus === "ready";
    const areCompareBranchesReady = compareBranchIds.every(
      (branchId) => repo.branches.find((branch) => branch.id === branchId)?.scanStatus === "ready"
    );

    return isMainReady && areCompareBranchesReady;
  }, [compareBranchIds, mainBranchId, repo]);

  const refreshRepoAfterScan = async () => {
    if (!repo) {
      return;
    }

    await fetchBranches(repo.id);
    const latest = useRepoStore.getState().repos.find((item) => item.id === repo.id);
    if (latest) {
      selectRepo(latest);
    }
  };

  const handleScanAll = () => {
    if (!repo) {
      return;
    }

    if (repo.branches.length === 0) {
      return;
    }

    const queue = repo.branches.map((branch) => branch.id);
    setScanQueue(queue);
    setActiveScanIndex(0);
    setScanSessionId((current) => current + 1);
    setScanningAll(true);
    setScanningBranchIds(queue);
  };

  const handleScanBranch = (branchId: number) => {
    if (!repo) {
      return;
    }

    setScanQueue([branchId]);
    setActiveScanIndex(0);
    setScanSessionId((current) => current + 1);
    setScanningBranchIds([branchId]);
  };

  const handleScanProgressComplete = async (_result: ScanResult) => {
    const currentBranchId = scanQueue[activeScanIndex];
    await refreshRepoAfterScan();

    if (currentBranchId) {
      setScanningBranchIds((current) => current.filter((id) => id !== currentBranchId));
    }

    if (scanQueue.length > 1 && activeScanIndex < scanQueue.length - 1) {
      setActiveScanIndex((current) => current + 1);
      return;
    }

    if (scanQueue.length > 1) {
      setScanQueue([]);
      setActiveScanIndex(0);
    }

    setScanningAll(false);
  };

  const handleScanCancel = () => {
    setScanQueue([]);
    setActiveScanIndex(0);
    setScanningAll(false);
    setScanningBranchIds([]);
  };

  const handleScanBackground = () => {
    setCompareError(null);
  };

  const handleToggleBranch = async (branch: Branch) => {
    if (!repo) {
      return;
    }

    if (expandedBranchId === branch.id) {
      setExpandedBranchId(null);
      setSelectedEndpoint(null);
      return;
    }

    if (!branch.endpoints) {
      const response = await axiosClient.get<BranchDetailsResponse>(`/branches/${branch.id}`);
      const detailedBranch = response.data;

      const updatedRepo: RepositoryType = {
        ...repo,
        branches: repo.branches.map((item) =>
          item.id === branch.id
            ? {
                ...item,
                endpoints: detailedBranch.endpoints,
                totalApis: detailedBranch.totalApis ?? item.totalApis,
              }
            : item
        ),
      };

      selectRepo(updatedRepo);
    }

    setExpandedBranchId(branch.id);
    setSelectedEndpoint(null);
  };

  const handleCompareClick = async () => {
    if (!repo || !mainBranchId || compareBranchIds.length === 0) {
      return;
    }

    setCompareError(null);
    await startSession(repo.id, mainBranchId, compareBranchIds);

    const sessionId = useConflictStore.getState().session?.id || session?.id;
    if (!sessionId) {
      setCompareError("Failed to create conflict session");
      return;
    }

    navigate(`/conflicts/${sessionId}`);
  };

  if (!isRepoIdValid) {
    return <div className="card text-red-400">Invalid repository ID</div>;
  }

  if (loading && !repo) {
    return (
      <div className="space-y-4">
        <div className="card animate-pulse h-24" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card animate-pulse h-28" />
          <div className="card animate-pulse h-28" />
        </div>
      </div>
    );
  }

  if (!repo) {
    return <div className="card text-red-400">Repository not found.</div>;
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Link to="/" className="inline-flex text-sm text-brand-500 hover:text-brand-100">
              ← Back
            </Link>

            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-white">{repo.name}</h2>
              <a
                href={repo.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="text-slate-300 transition hover:text-white"
                aria-label="Open repository on GitHub"
              >
                🔗
              </a>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                {repo.language || "Unknown"}
              </span>
            </div>

            <p className="text-sm text-slate-400">Last scanned: {formatLastScanned(repo.lastScanned)}</p>
          </div>

          <button type="button" className="btn-primary" onClick={handleScanAll} disabled={scanningAll}>
            {scanningAll ? "⏳ Scanning..." : "Scan All Branches"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-white">Branches</h3>

        <div className="grid gap-4 md:grid-cols-2">
          {repo.branches.map((branch) => {
            const isMainBranch = branch.type === "main";
            const isScanning = scanningBranchIds.includes(branch.id);
            const conflicts = (branch as Branch & { conflicts?: number }).conflicts ?? 0;

            return (
              <button
                type="button"
                key={branch.id}
                onClick={() => void handleToggleBranch(branch)}
                className="card text-left transition hover:border-brand-600"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="truncate text-base font-semibold text-white">
                    {isMainBranch ? "👑" : "🌿"} {branch.name}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleScanBranch(branch.id);
                    }}
                    className="btn-secondary text-sm"
                    disabled={isScanning}
                  >
                    {isScanning ? "⏳" : "Scan"}
                  </button>
                </div>

                <p className="text-sm text-slate-300">
                  {getBranchEndpointCount(branch)} endpoints • {getBranchStatusLabel(branch)}
                  {!isMainBranch ? ` • ⚠️ ${conflicts} conflicts` : ""}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Last scanned: {formatLastScanned(branch.lastScanned)}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {expandedBranch && (
        <section className="card space-y-4">
          <h3 className="text-lg font-semibold text-white">Endpoint Preview • {expandedBranch.name}</h3>

          <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
            <div className="overflow-x-auto rounded-lg border border-slate-700/70">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead className="bg-dark-900 text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Path</th>
                    <th className="px-3 py-2">Fields</th>
                    <th className="px-3 py-2">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {(expandedBranch.endpoints ?? []).map((endpoint) => {
                    const totalFields =
                      (endpoint.requiredFields?.length ?? 0) +
                      (endpoint.optionalFields?.length ?? 0) +
                      (endpoint.responseFields?.length ?? 0);

                    return (
                      <tr
                        key={endpoint.id}
                        onClick={() => setSelectedEndpoint(endpoint)}
                        className="cursor-pointer border-t border-slate-700/70 text-slate-200 transition hover:bg-dark-900"
                      >
                        <td className="px-3 py-2 font-medium">{endpoint.method}</td>
                        <td className="px-3 py-2">{endpoint.path}</td>
                        <td className="px-3 py-2">{totalFields}</td>
                        <td className="px-3 py-2">{endpoint.lineStart}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <aside className="rounded-lg border border-slate-700/70 bg-dark-900 p-4">
              <h4 className="text-sm font-semibold text-white">Field Details</h4>

              {!selectedEndpoint ? (
                <p className="mt-2 text-sm text-slate-400">Click an endpoint row to view full field list.</p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-200">{selectedEndpoint.method} {selectedEndpoint.path}</p>
                    <p className="text-xs text-slate-400">Line {selectedEndpoint.lineStart} - {selectedEndpoint.lineEnd}</p>
                  </div>

                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Required</p>
                    <ul className="space-y-1 text-slate-200">
                      {selectedEndpoint.requiredFields?.length ? (
                        selectedEndpoint.requiredFields.map((field, index) => (
                          <li key={`${field.name}-${index}`}>{field.name}: {field.type}</li>
                        ))
                      ) : (
                        <li className="text-slate-500">None</li>
                      )}
                    </ul>
                  </div>

                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Optional</p>
                    <ul className="space-y-1 text-slate-200">
                      {selectedEndpoint.optionalFields?.length ? (
                        selectedEndpoint.optionalFields.map((field, index) => (
                          <li key={`${field.name}-${index}`}>{field.name}: {field.type}</li>
                        ))
                      ) : (
                        <li className="text-slate-500">None</li>
                      )}
                    </ul>
                  </div>

                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Response</p>
                    <ul className="space-y-1 text-slate-200">
                      {selectedEndpoint.responseFields?.length ? (
                        selectedEndpoint.responseFields.map((field, index) => (
                          <li key={`${field.name}-${index}`}>{field.name}: {field.type}</li>
                        ))
                      ) : (
                        <li className="text-slate-500">None</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      <section className="card space-y-4">
        <h3 className="text-lg font-semibold text-white">Compare Branches</h3>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor="main-branch" className="mb-2 block text-sm text-slate-300">
              Select Main Branch
            </label>
            <select
              id="main-branch"
              value={mainBranchId ?? ""}
              onChange={(event) => setMainBranchId(Number(event.target.value) || null)}
              className="w-full rounded-lg border border-slate-700 bg-dark-900 px-3 py-2 text-sm text-white outline-none ring-brand-500 transition focus:ring-1"
            >
              <option value="">Select main branch</option>
              {mainBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-2 text-sm text-slate-300">Select Branches to Compare</p>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-dark-900 p-3">
              {featureBranches.map((branch) => {
                const checked = compareBranchIds.includes(branch.id);
                return (
                  <label key={branch.id} className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setCompareBranchIds((current) =>
                          checked ? current.filter((id) => id !== branch.id) : [...current, branch.id]
                        );
                      }}
                      className="accent-brand-600"
                    />
                    {branch.name}
                  </label>
                );
              })}
              {featureBranches.length === 0 && <p className="text-sm text-slate-500">No feature branches</p>}
            </div>
          </div>
        </div>

        {(compareError || error) && <p className="text-sm text-red-400">{compareError || error}</p>}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCompareClick}
            disabled={!canCompareSelected || sessionLoading}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sessionLoading ? "⏳ Creating session..." : "🔍 Detect Conflicts"}
          </button>
        </div>
      </section>

      {activeScanBranch && (
        <ScanProgress
          key={`${scanSessionId}-${activeScanBranch.id}`}
          repoName={repo.name}
          branchName={activeScanBranch.name}
          onComplete={(result) => {
            void handleScanProgressComplete(result);
          }}
          onCancel={handleScanCancel}
          onBackground={handleScanBackground}
        />
      )}
    </div>
  );
}

export default Repository;