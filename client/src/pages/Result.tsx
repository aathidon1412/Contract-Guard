import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { explainConflict, generateMigrationGuide } from "../api/aiApi";
import { useConflictStore } from "../store/conflictStore";
import { useSessionStore } from "../store/sessionStore";
import type { Conflict } from "../types";

type TabKey = "migration-guide" | "yaml";

interface GuideSection {
  title: string;
  changed: string;
  action: string;
  example: string;
}

const IMPACT_ORDER: Record<Conflict["impactLevel"], number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 1,
};

const parseGuideSections = (markdown: string): GuideSection[] => {
  const chunks = markdown
    .split(/^###\s+/gm)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trim());
    const title = lines[0] || "Untitled";

    const changedLine = lines.find((line) => line.toLowerCase().startsWith("changed:")) || "";
    const actionLine = lines.find((line) => line.toLowerCase().startsWith("action:")) || "";
    const exampleLine = lines.find((line) => line.toLowerCase().startsWith("example:")) || "";

    return {
      title,
      changed: changedLine.replace(/^changed:\s*/i, "") || "No details",
      action: actionLine.replace(/^action:\s*/i, "") || "No details",
      example: exampleLine.replace(/^example:\s*/i, "") || "No details",
    };
  });
};

function Result() {
  const { sessionId } = useParams();
  const numericSessionId = Number(sessionId);

  const [activeTab, setActiveTab] = useState<TabKey>("migration-guide");
  const [isGuideLoading, setIsGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [aiGuide, setAiGuide] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const {
    conflicts,
    scenarios,
    session,
    loading: conflictLoading,
    fetchSession,
  } = useConflictStore();

  const { migrationGuide, downloadGuide } = useSessionStore();

  useEffect(() => {
    if (Number.isNaN(numericSessionId)) {
      return;
    }

    const loadData = async () => {
      await fetchSession(numericSessionId);
      await downloadGuide(numericSessionId);
    };

    void loadData();
  }, [downloadGuide, fetchSession, numericSessionId]);

  const staticGuide = useMemo(() => {
    if (migrationGuide) {
      return migrationGuide;
    }

    if (!conflicts.length) {
      return "# Migration Guide\nNo conflict data available yet.";
    }

    return [
      "# Migration Guide",
      ...conflicts.map(
        (conflict) =>
          `### ${conflict.type} — ${conflict.fieldName}\nChanged: ${conflict.mainValue} → ${conflict.branchValue}\nAction: Update API contract consumers for ${conflict.method} ${conflict.endpoint}\nExample: Align payload field \"${conflict.fieldName}\" across all branches.`
      ),
    ].join("\n\n");
  }, [conflicts, migrationGuide]);

  const effectiveGuide = aiGuide || staticGuide;

  const parsedSections = useMemo(
    () => parseGuideSections(effectiveGuide),
    [effectiveGuide]
  );

  const criticalConflict = useMemo(() => {
    if (!conflicts.length) {
      return null;
    }

    return [...conflicts].sort(
      (left, right) => IMPACT_ORDER[right.impactLevel] - IMPACT_ORDER[left.impactLevel]
    )[0];
  }, [conflicts]);

  const handleGenerateGuide = async () => {
    if (!conflicts.length) {
      setGuideError("AI guide failed — showing basic guide");
      setAiGuide(null);
      setIsAiGenerated(false);
      return;
    }

    setGuideError(null);
    setIsGuideLoading(true);

    try {
      const result = await generateMigrationGuide(conflicts, scenarios);
      setAiGuide(result.guide);
      setIsAiGenerated(true);
      setExpandedSections({});
    } catch {
      setGuideError("AI guide failed — showing basic guide");
      setAiGuide(null);
      setIsAiGenerated(false);
    } finally {
      setIsGuideLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!criticalConflict) {
      setSummaryError("No conflicts available for summary");
      return;
    }

    setSummaryError(null);
    setSummaryLoading(true);

    try {
      const result = await explainConflict(criticalConflict);
      setSummaryText(result.explanation);
    } catch {
      setSummaryError("Failed to generate AI summary");
    } finally {
      setSummaryLoading(false);
    }
  };

  const toggleSection = (index: number) => {
    setExpandedSections((current) => ({
      ...current,
      [index]: !current[index],
    }));
  };

  if (Number.isNaN(numericSessionId)) {
    return <div className="card text-red-400">Invalid session ID</div>;
  }

  return (
    <div className="space-y-6">
      <section className="card border-brand-600/30 bg-brand-600/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">✨ AI Summary</h2>
            <p className="text-sm text-slate-300">Get a plain English summary of all changes</p>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handleGenerateSummary()}
            disabled={summaryLoading || conflictLoading}
          >
            {summaryLoading ? "Generating..." : summaryText ? "Regenerate" : "Generate"}
          </button>
        </div>

        {summaryText && <p className="mt-3 text-sm text-slate-200">{summaryText}</p>}
        {summaryError && <p className="mt-3 text-sm text-red-300">{summaryError}</p>}
      </section>

      <section className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-700/70 pb-3">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeTab === "migration-guide"
                ? "bg-brand-600/20 text-brand-300"
                : "bg-dark-900 text-slate-300 hover:text-white"
            }`}
            onClick={() => setActiveTab("migration-guide")}
          >
            Migration Guide
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeTab === "yaml"
                ? "bg-brand-600/20 text-brand-300"
                : "bg-dark-900 text-slate-300 hover:text-white"
            }`}
            onClick={() => setActiveTab("yaml")}
          >
            Session Info
          </button>
        </div>

        {activeTab === "migration-guide" && (
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-white">📋 Migration Guide</h3>

              <div className="flex items-center gap-2">
                {isAiGenerated && (
                  <span className="rounded-full border border-green-500/40 bg-green-500/20 px-2.5 py-1 text-xs text-green-300">
                    ✨ AI Generated
                  </span>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleGenerateGuide()}
                  disabled={isGuideLoading || conflictLoading}
                >
                  🤖 Generate with AI
                </button>
              </div>
            </div>

            {guideError && <p className="text-sm text-yellow-300">{guideError}</p>}

            <div className="space-y-3">
              {parsedSections.length ? (
                parsedSections.map((section, index) => {
                  const expanded = expandedSections[index] ?? true;

                  return (
                    <article key={`${section.title}-${index}`} className="rounded-lg border border-slate-700 bg-dark-900">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                        onClick={() => toggleSection(index)}
                      >
                        <span className="text-sm font-semibold text-white">### {section.title}</span>
                        <span className="text-slate-300">{expanded ? "▲" : "▼"}</span>
                      </button>

                      {expanded && (
                        <div className="space-y-2 border-t border-slate-700/70 px-4 py-3 text-sm">
                          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-200">
                            <strong>Changed:</strong> {section.changed}
                          </div>
                          <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-blue-200">
                            <strong>Action:</strong> {section.action}
                          </div>
                          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-200">
                            <strong>Example:</strong> {section.example}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })
              ) : (
                <div className="rounded-lg border border-slate-700 bg-dark-900 px-4 py-3 text-sm text-slate-300">
                  {effectiveGuide}
                </div>
              )}
            </div>

            {isGuideLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-dark-950/90 p-6">
                <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-dark-900 p-6 text-center">
                  <p className="text-lg font-semibold text-white">🤖 qwen2.5-coder:32b</p>
                  <p className="mt-2 text-slate-300">Generating migration guide...</p>
                  <p className="text-sm text-slate-400">This may take 30-60 seconds</p>

                  <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-700">
                    <div className="h-full w-2/3 animate-pulse rounded-full bg-brand-500" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "yaml" && (
          <div className="space-y-2 text-sm text-slate-300">
            <p>Session ID: {numericSessionId}</p>
            <p>Status: {session?.status || "Unknown"}</p>
            <p>Conflicts: {conflicts.length}</p>
            <p>Scenarios: {scenarios.length}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default Result;