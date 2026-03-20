import { useState } from "react";
import axios from 'axios'

import type { Conflict } from "../../types";
import { useConflictStore } from "../../store/conflictStore";

interface ConflictCardProps {
  conflict: Conflict;
  selectedResolution?: string;
  onResolve?: (resolution: "keep_main" | "use_branch" | "make_optional") => void;
}

type ResolutionOption = "keep_main" | "use_branch" | "make_optional";

function ConflictCard({ conflict, selectedResolution, onResolve }: ConflictCardProps) {
  const [explanation, setExplanation] = useState<string>("")
  const [explaining, setExplaining] = useState(false)
  const [explained, setExplained] = useState(false)

  const [suggestion, setSuggestion] = useState<string>("")
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionReason, setSuggestionReason] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string>("")

  const resolveConflict = useConflictStore((s: any) => s.resolveConflict)
  const undoResolveConflict = useConflictStore((s: any) => s.undoResolveConflict)
  const loadingIds = useConflictStore((s: any) => s.loadingIds)

  const [localLoadingAction, setLocalLoadingAction] = useState<ResolutionOption | null>(null)
  const [resolvedState, setResolvedState] = useState(conflict.status === 'resolved')
  const [resolutionLabel, setResolutionLabel] = useState<string | undefined>(conflict.resolution)
  const [collapsed, setCollapsed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleExplain() {
    setExplaining(true)
    try {
      const response = await axios.post(
        "http://localhost:5000/api/ai/explain/conflict",
        { conflict },
        { timeout: 120000 }
      )
      setExplanation(response.data.explanation)
      setExplained(true)
    } catch (error) {
      setExplanation("AI unavailable. Is Ollama running?")
    } finally {
      setExplaining(false)
    }
  }

  function highlightButton(value: string) {
    setHighlighted(value)
  }

  const handleSuggest = async () => {
    setSuggesting(true)
    try {
      const response = await axios.post(
        "http://localhost:5000/api/ai/suggest",
        { conflict },
        { timeout: 120000 }
      )

      const suggested = response.data.suggestion
      setSuggestion(suggested)
      setSuggestionReason(response.data.reason)

      if (suggested === "keep_main") highlightButton("keep_main")
      else if (suggested === "use_branch") highlightButton("use_branch")
      else if (suggested === "make_optional") highlightButton("make_optional")
    } catch (error) {
      setSuggestion("keep_main")
    } finally {
      setSuggesting(false)
    }
  };

  const handleRetry = async () => {
    if (explanation) {
      await handleSuggest();
      return;
    }
    await handleExplain();
  };

  const effectiveResolution = selectedResolution || undefined;

  const idStr = String(conflict.id)
  const isAnyLoading = loadingIds && loadingIds.has && loadingIds.has(idStr)

  const getResolutionButtonClass = (option: ResolutionOption, disabled?: boolean) => {
    const isSelected = effectiveResolution === option;
    const isHighlighted = highlighted === option;

    return `rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
      isSelected
        ? "border-brand-500 bg-brand-600/20 text-brand-200"
        : "border-slate-700 bg-dark-900 text-slate-300 hover:border-slate-500"
    } ${isHighlighted ? "ring-2 ring-green-500 ring-offset-1" : ""} ${
      disabled ? "opacity-50 pointer-events-none" : ""
    }`;
  };

  const doResolve = async (option: ResolutionOption, label: string) => {
    setActionError(null)
    setLocalLoadingAction(option)
    try {
      await resolveConflict(conflict.id, option)
      setResolvedState(true)
      setResolutionLabel(label)
      // show checkmark briefly then collapse
      setTimeout(() => setCollapsed(true), 1000)
      onResolve?.(option)
    } catch (err) {
      setActionError("Failed to resolve")
    } finally {
      setLocalLoadingAction(null)
    }
  }

  const doUndo = async () => {
    setActionError(null)
    try {
      await undoResolveConflict(conflict.id)
      setResolvedState(false)
      setResolutionLabel(undefined)
      setCollapsed(false)
    } catch (err) {
      setActionError("Failed to undo")
    }
  }

  return (
    <article className={`card space-y-4 ${resolvedState ? 'border-green-500/50 bg-green-500/5' : 'border-slate-700'}`}>
      {resolvedState && (
        <div className="rounded-t-md border-b border-green-500/30 bg-green-500/10 p-2 text-sm text-green-300">✅ Resolved — {resolutionLabel}</div>
      )}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-white">{conflict.method} {conflict.endpoint}</h3>
          <span className="badge-medium">{conflict.type}</span>
        </div>
        {!collapsed && (
          <>
            <p className="text-sm text-slate-300">Field: {conflict.fieldName}</p>
            <p className="text-sm text-slate-400">Main: {conflict.mainValue} • Branch: {conflict.branchValue}</p>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExplain()}
              disabled={explaining}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                explained
                  ? "border-green-500/40 bg-green-500/15 text-green-300"
                  : "border-slate-600 bg-transparent text-slate-200 hover:border-slate-400"
              }`}
            >
              {explaining ? (
                <span className="inline-flex items-center gap-2">🤖 Analyzing... <span className="h-3 w-3 rounded-full border-2 border-slate-300/40 animate-spin" /></span>
              ) : explained ? (
                "🤖 Explained ✓"
              ) : (
                "🤖 Explain"
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleSuggest()}
              disabled={suggesting}
              className="rounded-lg border border-slate-600 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-200 transition-all hover:border-slate-400"
            >
              {suggesting ? (
                <span className="inline-flex items-center gap-2">💡 Thinking... <span className="h-3 w-3 rounded-full border-2 border-slate-300/40 animate-spin" /></span>
              ) : suggestion ? (
                "💡 Suggested ✓"
              ) : (
                "💡 Suggest Fix"
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {!resolvedState && (
              <>
                <button
                  type="button"
                  className={getResolutionButtonClass("keep_main", Boolean(isAnyLoading && !localLoadingAction))}
                  onClick={() => void doResolve("keep_main", "Keep Main")}
                >
                  {localLoadingAction === 'keep_main' ? '⏳' : resolvedState ? '✅' : 'Keep Main'}
                </button>

                <button
                  type="button"
                  className={getResolutionButtonClass("use_branch", Boolean(isAnyLoading && !localLoadingAction))}
                  onClick={() => void doResolve("use_branch", "Use Branch")}
                >
                  {localLoadingAction === 'use_branch' ? '⏳' : 'Use Branch'}
                </button>

                {(conflict.type === 'FIELD_REMOVED' || conflict.type === 'REQUIRED_ADDED') && (
                  <button
                    type="button"
                    className={getResolutionButtonClass("make_optional", Boolean(isAnyLoading && !localLoadingAction))}
                    onClick={() => void doResolve("make_optional", "Make Optional")}
                  >
                    {localLoadingAction === 'make_optional' ? '⏳' : 'Make Optional'}
                  </button>
                )}
              </>
            )}

            {resolvedState && (
              <button type="button" className="text-sm text-slate-400" onClick={() => void doUndo()}>↩ Undo</button>
            )}
          </div>

          {suggestion && (
            <p className="text-xs text-green-400 mt-2">
              💡 AI suggests: {suggestion} — {suggestionReason}
            </p>
          )}

          {(explaining || suggesting) && (
            <div className="rounded-lg border border-slate-700 bg-dark-900 p-3">
              <p className="mb-2 text-sm text-slate-300">qwen2.5-coder:32b is thinking...</p>
              <div className="space-y-2 animate-pulse">
                <div className="h-3 w-full rounded bg-slate-700" />
                <div className="h-3 w-5/6 rounded bg-slate-700" />
                <div className="h-3 w-3/4 rounded bg-slate-700" />
              </div>
            </div>
          )}

          {explanation && (
            <div className="mt-3 p-3 bg-slate-700/50 border border-brand-500/30 rounded-lg text-sm">
              <p className="text-brand-400 font-medium mb-1">🤖 AI Explanation</p>
              <p className="text-slate-300">{explanation}</p>
            </div>
          )}

          {actionError && (
            <div className="text-sm text-red-300">{actionError}</div>
          )}
        </>
      )}
    </article>
  );
}

export default ConflictCard;
