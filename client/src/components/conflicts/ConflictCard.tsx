import { useState } from "react";

import { explainConflict, suggestResolution } from "../../api/aiApi";
import type { Conflict } from "../../types";

interface ConflictCardProps {
  conflict: Conflict;
  selectedResolution?: string;
  onResolve?: (resolution: "keep_main" | "use_branch" | "make_optional") => void;
}

type ResolutionOption = "keep_main" | "use_branch" | "make_optional";

function ConflictCard({ conflict, selectedResolution, onResolve }: ConflictCardProps) {
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<ResolutionOption | null>(null);
  const [suggestionReason, setSuggestionReason] = useState<string | null>(null);
  const [isExplainLoading, setIsExplainLoading] = useState(false);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleExplain = async () => {
    setAiError(null);
    setIsExplainLoading(true);

    try {
      const result = await explainConflict(conflict);
      setAiExplanation(result.explanation);
    } catch {
      setAiError("AI unavailable — is Ollama running?");
    } finally {
      setIsExplainLoading(false);
    }
  };

  const handleSuggest = async () => {
    setAiError(null);
    setIsSuggestLoading(true);

    try {
      const result = await suggestResolution(conflict);
      const option = result.suggestion as ResolutionOption;

      if (option === "keep_main" || option === "use_branch" || option === "make_optional") {
        setAiSuggestion(option);
      } else {
        setAiSuggestion("keep_main");
      }

      setSuggestionReason(result.reason);
    } catch {
      setAiError("AI unavailable — is Ollama running?");
    } finally {
      setIsSuggestLoading(false);
    }
  };

  const handleRetry = async () => {
    if (aiExplanation) {
      await handleSuggest();
      return;
    }
    await handleExplain();
  };

  const effectiveResolution = selectedResolution || aiSuggestion;

  const getResolutionButtonClass = (option: ResolutionOption) => {
    const isSelected = effectiveResolution === option;
    const isAiSuggested = aiSuggestion === option;

    return `rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
      isSelected
        ? "border-brand-500 bg-brand-600/20 text-brand-200"
        : "border-slate-700 bg-dark-900 text-slate-300 hover:border-slate-500"
    } ${isAiSuggested ? "ring-2 ring-green-400/60 shadow-[0_0_0_1px_rgba(74,222,128,0.35)]" : ""}`;
  };

  return (
    <article className="card space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-white">{conflict.method} {conflict.endpoint}</h3>
          <span className="badge-medium">{conflict.type}</span>
        </div>
        <p className="text-sm text-slate-300">Field: {conflict.fieldName}</p>
        <p className="text-sm text-slate-400">Main: {conflict.mainValue} • Branch: {conflict.branchValue}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleExplain()}
          disabled={isExplainLoading}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
            aiExplanation
              ? "border-green-500/40 bg-green-500/15 text-green-300"
              : "border-slate-600 bg-transparent text-slate-200 hover:border-slate-400"
          }`}
        >
          {isExplainLoading ? "⏳ Analyzing..." : aiExplanation ? "🤖 Explained ✓" : "🤖 Explain"}
        </button>

        <button
          type="button"
          onClick={() => void handleSuggest()}
          disabled={isSuggestLoading}
          className="rounded-lg border border-slate-600 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-200 transition-all hover:border-slate-400"
        >
          {isSuggestLoading ? "⏳ Thinking..." : "💡 Suggest Fix"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={getResolutionButtonClass("keep_main")}
          onClick={() => onResolve?.("keep_main")}
        >
          keep_main
        </button>
        <button
          type="button"
          className={getResolutionButtonClass("use_branch")}
          onClick={() => onResolve?.("use_branch")}
        >
          use_branch
        </button>
        <button
          type="button"
          className={getResolutionButtonClass("make_optional")}
          onClick={() => onResolve?.("make_optional")}
        >
          make_optional
        </button>
      </div>

      {suggestionReason && (
        <p className="text-sm text-green-300">AI suggests this because: {suggestionReason}</p>
      )}

      {(isExplainLoading || isSuggestLoading) && (
        <div className="rounded-lg border border-slate-700 bg-dark-900 p-3">
          <p className="mb-2 text-sm text-slate-300">qwen2.5-coder:32b is thinking...</p>
          <div className="space-y-2 animate-pulse">
            <div className="h-3 w-full rounded bg-slate-700" />
            <div className="h-3 w-5/6 rounded bg-slate-700" />
            <div className="h-3 w-3/4 rounded bg-slate-700" />
          </div>
        </div>
      )}

      {aiExplanation && !isExplainLoading && (
        <div className="rounded-lg border border-slate-700 bg-dark-900 p-3">
          <p className="mb-2 text-sm font-medium text-slate-200">🤖 AI Analysis</p>
          <p className="text-sm text-slate-300">{aiExplanation}</p>
          <div className="my-3 h-px bg-slate-700/70" />
          <p className="text-sm text-green-300">💡 Suggested: [{aiSuggestion || "keep_main"}]</p>
        </div>
      )}

      {aiError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">{aiError}</p>
          <button
            type="button"
            onClick={() => void handleRetry()}
            className="mt-2 rounded-lg border border-red-400/50 px-2.5 py-1 text-xs text-red-200 transition hover:border-red-300"
          >
            Retry
          </button>
        </div>
      )}
    </article>
  );
}

export default ConflictCard;
