import { useEffect, useMemo, useState } from "react";
import axios from "../api/axiosClient";
import ConflictList from "../components/conflicts/ConflictList";
import ConsolidationPopup from "../components/conflicts/ConsolidationPopup";
import { useParams, useNavigate } from "react-router-dom";

interface ConflictRow {
  id: number;
  sessionId: number;
  type: string;
  fieldName: string;
  endpoint: string;
  method: string;
  mainValue: string;
  branchValue: string;
  impactLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  resolution?: string;
  lineMain: number;
  lineBranch: number;
  branchName: string;
  status: "unresolved" | "resolved";
}

interface ConsolidationScenario {
  id: number;
  scenarioType: string;
  fieldName: string;
  affectedEndpoint: string;
  involvedBranches: string[];
  autoResolved: boolean;
  chosenOption?: string;
  status: string;
}

function mapToDetected(c: ConflictRow) {
  const severity = (c.impactLevel || "NONE") === "CRITICAL" ? "Critical" : (c.impactLevel === "HIGH" ? "High" : c.impactLevel === "MEDIUM" ? "Medium" : c.impactLevel === "LOW" ? "Low" : "Easy");
  return {
    id: String(c.id),
    type: c.type,
    severity,
    endpoint: c.endpoint,
    method: c.method,
    fieldName: c.fieldName,
    mainValue: c.mainValue,
    branchValue: c.branchValue,
    branchName: c.branchName,
    lineMain: c.lineMain,
    lineBranch: c.lineBranch,
    status: c.status,
    resolution: c.resolution,
  };
}

export default function ConflictsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [consolidations, setConsolidations] = useState<ConsolidationScenario[]>([]);
  const [showIndex, setShowIndex] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    // validate numeric sessionId to avoid calling server with non-numeric params
    const num = Number(sessionId);
    if (Number.isNaN(num)) {
      setLoading(false);
      setConflicts([]);
      setConsolidations([]);
      return;
    }
    setLoading(true);
    axios
      .get(`/conflicts/session/${sessionId}`)
      .then((res) => {
        const data = res.data;
        const grouped = data.conflictsGrouped || {};
        const flat: ConflictRow[] = [];
        for (const level of Object.keys(grouped)) {
          for (const c of grouped[level]) flat.push(c as ConflictRow);
        }
        setConflicts(flat);
        setConsolidations(data.consolidationConflicts || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  const branchCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conflicts) {
      map.set(c.branchName, (map.get(c.branchName) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [conflicts]);

  const total = conflicts.length;
  const resolved = conflicts.filter((c) => c.status === "resolved").length;
  const percent = total === 0 ? 0 : Math.round((resolved / total) * 100);

  const criticalRemaining = conflicts.filter((c) => c.impactLevel === "CRITICAL" && c.status === "unresolved").length;
  const highRemaining = conflicts.filter((c) => c.impactLevel === "HIGH" && c.status === "unresolved").length;

  const detected = conflicts.map(mapToDetected);

  const handleResolve = async (conflictId: string, resolution: string) => {
    try {
      await axios.patch(`/conflicts/${conflictId}/resolve`, { conflictId: Number(conflictId), resolution, resolvedBy: "user" });
      setConflicts((prev) => prev.map((p) => (String(p.id) === conflictId ? { ...p, status: "resolved", resolution } : p)));
    } catch (e) {}
  };

  const handleResolveConsolidation = async (id: string, option: string) => {
    try {
      await axios.patch(`/conflicts/consolidation/${id}/resolve`, { consolidationId: Number(id), chosenOption: option });
      setConsolidations((prev) => prev.filter((s) => String(s.id) !== id));
      setShowIndex((i) => i + 1);
    } catch {}
  };

  const handleSkip = () => setShowIndex((i) => i + 1);

  if (loading) return <div className="p-6">Loading...</div>;

  // handle invalid/non-numeric sessionId
  if (Number.isNaN(Number(sessionId))) {
    return <div className="p-6">Invalid session id</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-300">← Back to repo</button>
        <h2 className="text-lg font-semibold">user-service — Conflict Resolution</h2>
        <div className="flex gap-2">
          <button disabled={criticalRemaining + highRemaining > 0} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Generate Final Schema ▶</button>
        </div>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-6">
        <aside className="rounded-lg border border-slate-700 bg-dark-900 p-4">
          <div className="mb-4">
            <h3 className="text-sm text-slate-300">Branches</h3>
            <ul className="mt-2 space-y-2">
              <li className="flex items-center justify-between"><span>👑 main (base)</span><span className="text-xs text-slate-400">—</span></li>
              {branchCounts.map((b) => (
                <li key={b.name} className="flex items-center justify-between"><span>• {b.name}</span><span className="text-xs text-slate-400">{b.count} conflicts</span></li>
              ))}
            </ul>
          </div>

          <div className="mb-4">
            <h3 className="text-sm text-slate-300">Consolidation</h3>
            <p className="text-xs text-slate-400 mt-1">Merging 2+ branches?</p>
            <button className="mt-2 rounded border border-slate-600 px-3 py-1 text-sm">Run Consolidation Check</button>
          </div>

          <div>
            <h3 className="text-sm text-slate-300">Progress</h3>
            <div className="text-xs text-slate-400">Total: {total}</div>
            <div className="text-xs text-slate-400">Resolved: {resolved}</div>
            <div className="mt-2 w-full bg-slate-800 rounded-full h-3 overflow-hidden"><div style={{ width: `${percent}%` }} className="h-3 bg-gradient-to-r from-green-400 to-green-600" /></div>
            <ul className="mt-3 text-xs text-slate-300 space-y-1">
              <li>Critical: <span className="text-red-400">{criticalRemaining} remaining</span></li>
              <li>High: {highRemaining} remaining</li>
              <li>Medium: {conflicts.filter((c) => c.impactLevel === "MEDIUM" && c.status === "unresolved").length} remaining</li>
              <li>Low: {conflicts.filter((c) => c.impactLevel === "LOW" && c.status === "unresolved").length} remaining</li>
              <li>Easy: {conflicts.filter((c) => c.impactLevel === "NONE" && c.status === "unresolved").length} remaining</li>
            </ul>
          </div>
        </aside>

        <main>
          <ConflictList sessionId={Number(sessionId)} conflicts={detected} onResolve={handleResolve} />
        </main>
      </div>

      {consolidations && consolidations.length > 0 && showIndex < consolidations.length && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10">
            <ConsolidationPopup
              scenario={{
                id: String(consolidations[showIndex].id),
                scenarioType: consolidations[showIndex].scenarioType,
                fieldName: consolidations[showIndex].fieldName,
                endpoint: consolidations[showIndex].affectedEndpoint,
                method: "",
                branchAName: consolidations[showIndex].involvedBranches?.[0] ?? "A",
                branchBName: consolidations[showIndex].involvedBranches?.[1] ?? "B",
                branchAAction: "",
                branchBAction: "",
                description: "",
                subOptions: [
                  { value: "use_rename", label: "Use Branch B", description: "", consequence: "", recommended: true },
                  { value: "use_removal", label: "Remove field", description: "", consequence: "", recommended: false },
                ],
                autoResolvable: false,
                autoResolution: null,
              }}
              index={showIndex + 1}
              total={consolidations.length}
              onResolve={(id, opt) => void handleResolveConsolidation(id, opt)}
              onSkip={() => handleSkip()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
