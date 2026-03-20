import { useState } from "react";

import { explainScenario } from "../../api/aiApi";
import type { CrossBranchScenario } from "../../types";

interface CrossBranchPopupProps {
  scenario: CrossBranchScenario;
  open: boolean;
  onClose: () => void;
}

function CrossBranchPopup({ scenario, open, onClose }: CrossBranchPopupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const handleExplain = async () => {
    setError(null);
    setIsExpanded(true);
    setIsLoading(true);

    try {
      const result = await explainScenario(scenario);
      setAnalysis(result.explanation);
    } catch {
      setError("AI unavailable — is Ollama running?");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Cross-Branch Scenario</h3>
            <p className="text-sm text-slate-300">{scenario.scenarioType}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="rounded-lg border border-slate-700 bg-dark-900 p-3 text-sm text-slate-300">
          <p>Field: {scenario.fieldName || "N/A"}</p>
          <p>Endpoint: {scenario.affectedEndpoint || "N/A"}</p>
          <p>
            Branches: {Array.isArray(scenario.involvedBranches) ? scenario.involvedBranches.join(", ") : "N/A"}
          </p>
        </div>

        <button type="button" onClick={() => void handleExplain()} className="btn-secondary">
          🤖 Explain This Scenario
        </button>

        {(isExpanded || isLoading || error) && (
          <div className="rounded-lg border border-slate-700 bg-dark-900 p-3">
            <button
              type="button"
              className="mb-2 text-sm font-medium text-slate-200"
              onClick={() => setIsExpanded((value) => !value)}
            >
              AI Risk Analysis {isExpanded ? "▲" : "▼"}
            </button>

            {isExpanded && (
              <div>
                {isLoading && (
                  <div>
                    <p className="mb-2 text-sm text-slate-300">qwen2.5-coder:32b is thinking...</p>
                    <div className="space-y-2 animate-pulse">
                      <div className="h-3 w-full rounded bg-slate-700" />
                      <div className="h-3 w-11/12 rounded bg-slate-700" />
                      <div className="h-3 w-4/5 rounded bg-slate-700" />
                    </div>
                  </div>
                )}

                {analysis && !isLoading && <p className="text-sm text-slate-300">{analysis}</p>}

                {error && !isLoading && (
                  <div>
                    <p className="text-sm text-red-300">{error}</p>
                    <button
                      type="button"
                      onClick={() => void handleExplain()}
                      className="mt-2 rounded-lg border border-red-400/50 px-2.5 py-1 text-xs text-red-200 transition hover:border-red-300"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CrossBranchPopup;
