import { useMemo, useState } from "react";
import axios from 'axios'
import { useNavigate } from "react-router-dom";
import ConflictCard from "./ConflictCard";
import { useConflictStore } from "../../store/conflictStore";
import { useSessionStore } from "../../store/sessionStore";
import toast from 'react-hot-toast'

type Severity = "Critical" | "High" | "Medium" | "Low" | "Easy";

export interface DetectedConflict {
  id: string;
  type: string;
  severity: Severity;
  endpoint: string;
  method: string;
  fieldName: string;
  mainValue: string;
  branchValue: string;
  branchName: string;
  lineMain: number;
  lineBranch: number;
  status: "unresolved" | "resolved";
  resolution?: string;
}

interface Props {
  sessionId: number;
  conflicts: DetectedConflict[];
  onResolve: (conflictId: string, resolution: string) => void;
}

const SEVERITY_ORDER: Severity[] = ["Critical", "High", "Medium", "Low", "Easy"];

function useGrouped(conflicts: DetectedConflict[]) {
  return useMemo(() => {
    const grouped: Record<Severity, DetectedConflict[]> = {
      Critical: [],
      High: [],
      Medium: [],
      Low: [],
      Easy: [],
    };

    for (const c of conflicts) {
      (grouped[c.severity] || grouped.Medium).push(c);
    }

    return grouped;
  }, [conflicts]);
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
      <div style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} className="h-3 bg-gradient-to-r from-green-400 to-green-600" />
    </div>
  );
}

function ConflictList({ sessionId, conflicts, onResolve }: Props) {
  const grouped = useGrouped(conflicts);
  const total = conflicts.length;
  const resolvedCount = conflicts.filter((c) => c.status !== "unresolved").length;

  const counts = {
    Critical: grouped.Critical.length,
    High: grouped.High.length,
    Medium: grouped.Medium.length,
    Low: grouped.Low.length,
    Easy: grouped.Easy.length,
  };

  const percent = total === 0 ? 0 : Math.round((resolvedCount / total) * 100);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (s: Severity) => setCollapsed((p) => ({ ...p, [s]: !p[s] }));

  const [resolvingCritical, setResolvingCritical] = useState(false)

  async function handleResolveAllCritical() {
    const criticalCount = conflicts.filter(
      (c) => c.severity === "Critical" && c.status === "unresolved"
    ).length

    if (criticalCount === 0) {
      toast.info("No critical conflicts remaining")
      return
    }

    const confirmed = window.confirm(
      `Resolve all ${criticalCount} critical conflicts\nby keeping main version?`
    )
    if (!confirmed) return

    setResolvingCritical(true)
    try {
      await axios.post(
        `http://localhost:5000/api/conflicts/session/${sessionId}/bulk-resolve`,
        {
          resolution: "keep_all_main",
          severity: "Critical",
        }
      )

      // Update local state
      useConflictStore.getState().updateBulkResolved("Critical", "keep_main")

      toast.success("All critical conflicts resolved")
    } catch (error) {
      console.error(error)
      toast.error("Failed to resolve critical conflicts")
    } finally {
      setResolvingCritical(false)
    }
  }

  

  const [keepingAll, setKeepingAll] = useState(false)

  async function handleKeepAllMain() {
    const unresolvedCount = conflicts.filter((c) => c.status === "unresolved").length

    if (unresolvedCount === 0) {
      toast.info("All conflicts already resolved")
      return
    }

    const confirmed = window.confirm(
      `Keep main version for ALL\n ${unresolvedCount} unresolved conflicts?\n This will resolve everything at once.`
    )
    if (!confirmed) return

    setKeepingAll(true)
    try {
      await axios.post(
        `http://localhost:5000/api/conflicts/session/${sessionId}/bulk-resolve`,
        { resolution: "keep_all_main" }
      )

      // Update ALL unresolved conflicts in local state
      useConflictStore.getState().updateBulkResolved(undefined, "keep_main")

      toast.success(`${unresolvedCount} conflicts resolved — main kept`)
    } catch (error) {
      console.error(error)
      toast.error("Failed to resolve conflicts")
    } finally {
      setKeepingAll(false)
    }
  }

  const handleUseAllBranch = () => {
    // legacy shim kept — replaced by applyUseBranch/branch picker UI
    const branchNames = Array.from(new Set(conflicts.map((c) => c.branchName).filter(Boolean)))
    if (branchNames.length === 0) {
      toast("No branch information available")
      return
    }
    if (branchNames.length === 1) {
      void applyUseBranch(branchNames[0])
      return
    }
    // multiple branches -> show picker
    setShowBranchPicker(true)
  };

  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState("")
  const [usingBranch, setUsingBranch] = useState(false)

  async function applyUseBranch(branchName: string) {
    const unresolvedCount = conflicts.filter((c) => c.status === "unresolved" && c.branchName === branchName).length

    const confirmed = window.confirm(
      `Use ${branchName} version for all\n ${unresolvedCount} unresolved conflicts?`
    )
    if (!confirmed) return

    setUsingBranch(true)
    setShowBranchPicker(false)
    try {
      await axios.post(
        `http://localhost:5000/api/conflicts/session/${sessionId}/bulk-resolve`,
        {
          resolution: "use_all_branch",
          branchName,
        }
      )

      useConflictStore.getState().updateBulkResolved(undefined, "use_branch", branchName)

      toast.success(`All conflicts resolved using ${branchName}`)
    } catch (error) {
      console.error(error)
      toast.error("Failed to apply branch resolution")
    } finally {
      setUsingBranch(false)
    }
  }

  const navigate = useNavigate()
  const finalizeSession = useSessionStore((s) => s.finalizeSession)
  const criticalUnresolved = conflicts.filter((c) => c.severity === 'Critical' && c.status === 'unresolved').length
  const highUnresolved = conflicts.filter((c) => c.severity === 'High' && c.status === 'unresolved').length

  const handleGenerateFinal = async () => {
    if (criticalUnresolved > 0 || highUnresolved > 0) return
    try {
      // show loading
      toast.loading('Building final schema...')
      await finalizeSession(sessionId)
      navigate(`/result/${sessionId}`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to build final schema')
    }
  }

  return (
    <div className="space-y-6">
      {/* Top summary bar */}
      <div className="rounded-lg border border-slate-700 bg-dark-900 p-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-4 items-center">
            <div className="text-sm text-slate-200">🔴 Critical: {counts.Critical}</div>
            <div className="text-sm text-slate-200">🟠 High: {counts.High}</div>
            <div className="text-sm text-slate-200">🟡 Medium: {counts.Medium}</div>
            <div className="text-sm text-slate-200">🔵 Low: {counts.Low}</div>
            <div className="text-sm text-slate-200">🟢 Easy: {counts.Easy}</div>
          </div>
          <div className="text-sm text-slate-300">Total: {total} • Resolved: {resolvedCount}</div>
        </div>

        <div className="mt-3">
          <ProgressBar percent={percent} />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-slate-400">{percent}% Complete</div>
            <div className="flex gap-2">
              <button
                onClick={handleResolveAllCritical}
                disabled={resolvingCritical || criticalUnresolved === 0}
                title={criticalUnresolved === 0 ? "No critical conflicts" : undefined}
                className={`rounded bg-red-600 px-3 py-1 text-xs font-medium ${resolvingCritical ? 'opacity-70 pointer-events-none' : ''}`}
              >
                {resolvingCritical ? (
                  <span className="inline-flex items-center gap-2">Resolving... <span className="h-3 w-3 rounded-full border-2 border-white/40 animate-spin" /></span>
                ) : (
                  'Resolve All Critical'
                )}
              </button>
              <button
                onClick={handleKeepAllMain}
                disabled={keepingAll || conflicts.filter((c) => c.status === 'unresolved').length === 0}
                className={`rounded border border-slate-600 px-3 py-1 text-xs ${keepingAll ? 'opacity-70 pointer-events-none' : ''}`}
              >
                {keepingAll ? (
                  <span className="inline-flex items-center gap-2">Applying... <span className="h-3 w-3 rounded-full border-2 border-slate-600 animate-spin" /></span>
                ) : (
                  'Keep All Main'
                )}
              </button>
              <div className="relative">
                <button
                  onClick={handleUseAllBranch}
                  disabled={conflicts.filter((c) => c.branchName).length === 0 || usingBranch}
                  className={`rounded border border-slate-600 px-3 py-1 text-xs ${usingBranch ? 'opacity-70 pointer-events-none' : ''}`}
                >
                  {usingBranch ? (
                    <span className="inline-flex items-center gap-2">Applying... <span className="h-3 w-3 rounded-full border-2 border-slate-600 animate-spin" /></span>
                  ) : (
                    'Use Branch'
                  )}
                </button>

                {showBranchPicker && (
                  <div className="absolute top-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50">
                    <p className="text-xs text-slate-400 px-3 pt-2">Select branch to use:</p>
                    {Array.from(new Set(conflicts.map((c) => c.branchName).filter(Boolean))).map((b) => (
                      <button
                        key={b}
                        onClick={() => void applyUseBranch(b)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-slate-200"
                      >
                        🌿 {b}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowBranchPicker(false)}
                      className="w-full text-left px-3 py-2 text-slate-500 text-xs border-t border-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Groups */}
      {SEVERITY_ORDER.map((sev) => {
        const list = grouped[sev];
        const unresolved = list.filter((c) => c.status === "unresolved").length;
        const isCollapsed = !!collapsed[sev];

        return (
          <section key={sev} className="space-y-3">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold text-white">{sev} ({unresolved} unresolved)</h4>
                <button className="text-xs text-slate-400" onClick={() => toggle(sev)}>{isCollapsed ? "[► expand]" : "[▼ collapse]"}</button>
              </div>
            </header>

            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-4">
                {list.map((c) => (
                  <div key={c.id} className={`rounded-lg ${c.status === "resolved" ? "border-green-500 bg-green-900/10" : "border-slate-700 bg-dark-900"} border p-3`}>
                    {c.status === "resolved" ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-green-300">✓</span>
                          <div>
                            <div className="text-sm font-medium text-white">{c.method} {c.endpoint}</div>
                            <div className="text-xs text-slate-300">{c.fieldName} • {c.resolution}</div>
                          </div>
                        </div>
                        <button className="text-xs text-slate-300" onClick={() => onResolve(c.id, "undo")}>Undo</button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">{c.method} {c.endpoint}</div>
                            <div className="text-xs text-slate-300">{c.type}</div>
                          </div>
                          <div className="text-xs text-slate-400">{c.branchName}</div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <div className="text-xs text-slate-400">MAIN</div>
                            <div className="text-sm text-slate-200">{c.fieldName}</div>
                            <div className="text-xs text-slate-400">{c.mainValue}</div>
                            <div className="text-xs text-slate-500">line: {c.lineMain || "—"}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-slate-400">BRANCH</div>
                            <div className="text-sm text-slate-200">{c.branchName}</div>
                            <div className="text-xs text-slate-400">{c.branchValue || "[removed]"}</div>
                            <div className="text-xs text-slate-500">line: {c.lineBranch || "—"}</div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => onResolve(c.id, "keep_main")} className="rounded-lg border px-3 py-1 text-xs">✓ Keep Main</button>
                          <button onClick={() => onResolve(c.id, "use_branch")} className="rounded-lg border px-3 py-1 text-xs">Use Branch</button>
                          <button onClick={() => onResolve(c.id, "make_optional")} className="rounded-lg border px-3 py-1 text-xs">Make Optional</button>
                        </div>

                        <div className="flex items-center gap-2">
                          <button className="text-xs text-slate-300">🤖 Explain</button>
                          <button className="text-xs text-slate-300">💡 Suggest Fix</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default ConflictList;
