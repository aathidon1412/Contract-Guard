import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useRepoStore } from "../../store/repoStore";

export interface ScanResult {
  totalFiles: number;
  apiFiles: number;
  endpoints: number;
  fields: number;
  percent: number;
  elapsedSeconds: number;
  fileSummaries: Array<{ fileName: string; endpointCount: number }>;
}

export interface ScanProgressProps {
  repoName: string;
  branchName: string;
  onComplete: (result: ScanResult) => void;
  onCancel: () => void;
  onBackground: () => void;
}

type PhaseStatus = "pending" | "running" | "complete" | "failed";

export type LogMessage = {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "skip" | "found" | "error";
  text: string;
  indent: number;
  kind?: "field" | "route" | "backtrack" | "generic";
  field?: {
    name: string;
    fieldType: string;
    required: boolean;
    source?: string;
  };
};

type PhaseLogMessage = LogMessage & { phase: 1 | 2 | 3 };

type StreamEnvelope = {
  event: string;
  data: Record<string, unknown>;
};

const typeColorMap: Record<LogMessage["type"], string> = {
  info: "text-slate-400",
  success: "text-green-400",
  skip: "text-slate-600",
  found: "text-brand-400",
  error: "text-red-400",
};

const phaseTitle: Record<1 | 2 | 3, string> = {
  1: "PHASE 1 — Finding API Files",
  2: "PHASE 2 — Extracting API Info",
  3: "PHASE 3 — Saving to Database",
};

const phaseStatusText: Record<PhaseStatus, string> = {
  pending: "⏳ Pending",
  running: "🔄 Running",
  complete: "✅ Complete",
  failed: "❌ Failed",
};

const getPhaseTone = (status: PhaseStatus) => {
  if (status === "running") {
    return "text-brand-100";
  }
  if (status === "complete") {
    return "text-green-400";
  }
  if (status === "failed") {
    return "text-red-400";
  }
  return "text-slate-400";
};

const ScanProgress = ({ repoName, branchName, onComplete, onCancel, onBackground }: ScanProgressProps) => {
  const { repos, selectedRepo } = useRepoStore();

  const branchId = useMemo(() => {
    const sourceRepo =
      selectedRepo?.fullName === repoName || selectedRepo?.name === repoName
        ? selectedRepo
        : repos.find((repo) => repo.fullName === repoName || repo.name === repoName);

    return sourceRepo?.branches.find((branch) => branch.name === branchName)?.id ?? null;
  }, [branchName, repoName, repos, selectedRepo]);

  const startedAtRef = useRef<number>(Date.now());
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runningPhaseRef = useRef<1 | 2 | 3>(1);
  const fileEndpointMapRef = useRef<Record<string, number>>({});
  const backgroundModeRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  const [phaseStatus, setPhaseStatus] = useState<Record<1 | 2 | 3, PhaseStatus>>({
    1: "pending",
    2: "pending",
    3: "pending",
  });
  const [messages, setMessages] = useState<PhaseLogMessage[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [processingFile, setProcessingFile] = useState<string>("");
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [summary, setSummary] = useState<ScanResult | null>(null);
  const [isBackgroundMode, setIsBackgroundMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [fileEndpointMap, setFileEndpointMap] = useState<Record<string, number>>({});

  const runningPhase = useMemo<1 | 2 | 3>(() => {
    if (phaseStatus[3] === "running") {
      return 3;
    }
    if (phaseStatus[2] === "running") {
      return 2;
    }
    return 1;
  }, [phaseStatus]);

  const visibleMessages = useMemo(() => messages.slice(0, visibleCount), [messages, visibleCount]);

  const groupedMessages = useMemo(() => {
    const group: Record<1 | 2 | 3, PhaseLogMessage[]> = { 1: [], 2: [], 3: [] };
    visibleMessages.forEach((message) => {
      group[message.phase].push(message);
    });
    return group;
  }, [visibleMessages]);

  const waitingFiles = useMemo(() => {
    const files = Object.keys(fileEndpointMap);
    if (processingFile) {
      return files.filter((file) => file !== processingFile);
    }
    return files;
  }, [fileEndpointMap, processingFile]);

  useEffect(() => {
    runningPhaseRef.current = runningPhase;
  }, [runningPhase]);

  useEffect(() => {
    fileEndpointMapRef.current = fileEndpointMap;
  }, [fileEndpointMap]);

  useEffect(() => {
    backgroundModeRef.current = isBackgroundMode;
  }, [isBackgroundMode]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (visibleCount >= messages.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      setVisibleCount((current) => Math.min(current + 1, messages.length));
    }, 200);

    return () => window.clearTimeout(timer);
  }, [messages.length, visibleCount]);

  useEffect(() => {
    if (!logContainerRef.current) {
      return;
    }

    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [visibleMessages.length]);

  useEffect(() => {
    if (!branchId) {
      setStreamError("Unable to resolve branch for live scan stream");
      return;
    }

    const addMessage = (
      type: LogMessage["type"],
      text: string,
      indent = 0,
      phase: 1 | 2 | 3 = runningPhaseRef.current,
      extras?: Pick<LogMessage, "kind" | "field">
    ) => {
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date(),
          type,
          text,
          indent,
          phase,
          kind: extras?.kind,
          field: extras?.field,
        },
      ]);
    };

    const source = new EventSource(`http://localhost:5000/api/branches/${branchId}/scan-stream`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      let payload: StreamEnvelope;

      try {
        payload = JSON.parse(event.data) as StreamEnvelope;
      } catch {
        return;
      }

      if (!payload || !payload.event) {
        return;
      }

      if (payload.event === "phase") {
        const phase = Number(payload.data.phase) as 1 | 2 | 3;
        const status = String(payload.data.status) as PhaseStatus;

        if (phase >= 1 && phase <= 3) {
          setPhaseStatus((current) => ({ ...current, [phase]: status }));
        }
        return;
      }

      if (payload.event === "file_found") {
        const fileName = String(payload.data.fileName ?? "unknown");
        setFileEndpointMap((current) => ({ ...current, [fileName]: current[fileName] ?? 0 }));
        addMessage("success", `✅ ${fileName} → API file detected`, 0, 1);
        return;
      }

      if (payload.event === "file_skip") {
        const fileName = String(payload.data.fileName ?? "unknown");
        const reason = String(payload.data.reason ?? "Skipped");
        addMessage("skip", `⏭️ ${fileName} → ${reason}`, 0, 1);
        return;
      }

      if (payload.event === "endpoint_found") {
        const fileName = String(payload.data.fileName ?? "unknown");
        const method = String(payload.data.method ?? "GET");
        const path = String(payload.data.path ?? "/");
        const fieldsCount = Number(payload.data.fieldsCount ?? 0);
        const handler = String(payload.data.handler ?? "unknown");
        const handlerType = String(payload.data.handlerType ?? "reference");

        setProcessingFile(fileName);
        setFileEndpointMap((current) => ({
          ...current,
          [fileName]: (current[fileName] ?? 0) + 1,
        }));

        addMessage("found", `├── ${method.padEnd(6, " ")} ${path} → handler: ${handler}`, 1, 2, {
          kind: "route",
        });

        if (handlerType === "inline") {
          addMessage("success", "✅ Inline function — no backtracking needed", 2, 2, {
            kind: "backtrack",
          });
        }

        addMessage("info", `├── fields detected: ${fieldsCount}`, 2, 2);
        return;
      }

      if (payload.event === "backtrack_start") {
        const searchingIn = String(payload.data.searchingIn ?? "unknown");
        addMessage("found", `🔍 Backtracking to ${searchingIn}...`, 2, 2, {
          kind: "backtrack",
        });
        return;
      }

      if (payload.event === "backtrack_found") {
        const handler = String(payload.data.handler ?? "handler");
        const depth = Number(payload.data.depth ?? 0);
        const foundIn = String(payload.data.foundIn ?? "unknown");
        addMessage("success", `✅ Found ${handler}() in ${foundIn} (depth ${depth})`, 2, 2, {
          kind: "backtrack",
        });
        return;
      }

      if (payload.event === "fields_extracted") {
        const handler = String(payload.data.handler ?? "handler");
        const extractedFrom = String(payload.data.extractedFrom ?? "function body patterns");
        addMessage("info", `├── ${handler}: extracted from ${extractedFrom}`, 3, 2, {
          kind: "backtrack",
        });
        return;
      }

      if (payload.event === "backtrack_failed") {
        const handler = String(payload.data.handler ?? "handler");
        const reason = String(payload.data.reason ?? "Backtracking failed");
        addMessage("error", `❌ ${handler}: ${reason}`, 2, 2, {
          kind: "backtrack",
        });
        return;
      }

      if (payload.event === "field_extracted") {
        const fieldName = String(payload.data.fieldName ?? "field");
        const fieldType = String(payload.data.fieldType ?? "string");
        const required = Boolean(payload.data.required);
        const source = String(payload.data.source ?? "body");

        addMessage("info", "field", 3, 2, {
          kind: "field",
          field: {
            name: fieldName,
            fieldType,
            required,
            source,
          },
        });
        return;
      }

      if (payload.event === "saving") {
        const text = String(payload.data.message ?? "Working...");
        addMessage("info", text, 0, 3);
        return;
      }

      if (payload.event === "progress") {
        const current = Number(payload.data.current ?? 0);
        const total = Number(payload.data.total ?? 0);
        const percent = Number(payload.data.percent ?? 0);
        setProgress({ current, total, percent });
        return;
      }

      if (payload.event === "error") {
        const message = String(payload.data.message ?? "Scan failed");
        setPhaseStatus((current) => ({
          ...current,
          [runningPhaseRef.current]: "failed",
        }));
        setStreamError(message);
        addMessage("error", `❌ ${message}`, 0, runningPhaseRef.current);
        return;
      }

      if (payload.event === "complete") {
        const elapsedSeconds = (Date.now() - startedAtRef.current) / 1000;
        const result: ScanResult = {
          totalFiles: Number(payload.data.totalFiles ?? 0),
          apiFiles: Number(payload.data.apiFiles ?? 0),
          endpoints: Number(payload.data.endpoints ?? 0),
          fields: Number(payload.data.fields ?? 0),
          percent: 100,
          elapsedSeconds,
          fileSummaries: Object.entries(fileEndpointMapRef.current).map(([fileName, endpointCount]) => ({
            fileName,
            endpointCount,
          })),
        };

        setPhaseStatus({ 1: "complete", 2: "complete", 3: "complete" });
        setProgress({
          current: result.endpoints,
          total: Math.max(result.endpoints, 1),
          percent: 100,
        });
        setSummary(result);
        onCompleteRef.current(result);

        if (backgroundModeRef.current) {
          setToast(`✅ ${branchName} scanned — ${result.endpoints} endpoints found`);
        }

        source.close();
      }
    };

    source.onerror = () => {
      setStreamError("Live scan stream disconnected");
      source.close();
    };

    return () => {
      source.close();
    };
  }, [branchId, branchName]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3400);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeAndCancel = () => {
    eventSourceRef.current?.close();
    onCancel();
  };

  const setBackground = () => {
    setIsBackgroundMode(true);
    onBackground();
  };

  const showModal = () => {
    setIsBackgroundMode(false);
  };

  const renderPhase = (phase: 1 | 2 | 3) => {
    const status = phaseStatus[phase];
    const statusTone = getPhaseTone(status);
    const phaseRows = groupedMessages[phase];

    const renderMessageContent = (message: PhaseLogMessage): ReactNode => {
      if (message.kind === "field" && message.field) {
        return (
          <span>
            <span className="text-slate-600">├── </span>
            <span className="font-semibold text-white">{message.field.name}</span>
            <span className="text-slate-400"> ({message.field.fieldType}, {message.field.required ? "required" : "optional"})</span>
            <span className="text-slate-400"> → </span>
            <span className="inline-flex items-center rounded border border-slate-700 bg-dark-900 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-300">
              {message.field.source}
            </span>
          </span>
        );
      }

      if (message.kind === "route") {
        return (
          <span>
            <span className="text-slate-600">├── </span>
            {message.text.replace(/^├──\s*/, "")}
          </span>
        );
      }

      return message.text;
    };

    return (
      <div className="space-y-3">
        <div
          className={`flex items-center justify-between border-b border-slate-700/70 pb-2 ${
            status === "running" ? "phase-running-glow" : ""
          } ${status === "complete" ? "phase-complete-flash" : ""}`}
        >
          <h4 className={`text-sm font-semibold ${statusTone}`}>{phaseTitle[phase]}</h4>
          <span className={`text-xs font-medium ${statusTone}`}>{phaseStatusText[status]}</span>
        </div>

        <div className="space-y-1 text-sm">
          {phaseRows.length === 0 ? (
            <p className="text-slate-500">Waiting for events...</p>
          ) : (
            phaseRows.map((message) => (
              <p
                key={message.id}
                className={`scan-log-enter ${typeColorMap[message.type]} ${message.type === "found" ? "endpoint-row-enter" : ""}`}
                style={{ paddingLeft: `${message.indent * 18}px` }}
              >
                {renderMessageContent(message)}
                {message.type === "found" ? <span className="check-pop ml-1 inline-block">✅</span> : null}
              </p>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {!isBackgroundMode && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-[700px] rounded-xl border border-slate-700 bg-dark-800 shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-700/70 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">🤖 AI Scanning in Progress</h3>
                <p className="text-sm text-slate-400">{repoName} / {branchName}</p>
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                aria-label="Scan options"
              >
                ···
              </button>
            </header>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4" ref={logContainerRef}>
              {summary ? (
                <div className="space-y-5 text-sm">
                  <div className="space-y-2 text-center">
                    <h4 className="text-2xl font-semibold text-green-400">✅ Scan Complete!</h4>
                    <p className="text-slate-300">{branchName}</p>
                  </div>

                  <div className="space-y-1 rounded-lg border border-slate-700/70 bg-dark-900 p-4 text-slate-200">
                    <p>📄 Files scanned: {summary.totalFiles}</p>
                    <p>🎯 API files found: {summary.apiFiles}</p>
                    <p>🔗 Endpoints extracted: {summary.endpoints}</p>
                    <p>📊 Fields captured: {summary.fields}</p>
                    <p>⏱️ Time taken: {summary.elapsedSeconds.toFixed(1)} seconds</p>
                  </div>

                  <div className="space-y-2 rounded-lg border border-slate-700/70 bg-dark-900 p-4">
                    <p className="text-sm font-semibold text-white">API Files Detected:</p>
                    {summary.fileSummaries.length === 0 ? (
                      <p className="text-sm text-slate-500">No API files recorded.</p>
                    ) : (
                      summary.fileSummaries.map((file) => (
                        <p key={file.fileName} className="text-sm text-slate-200">
                          ✅ {file.fileName} → {file.endpointCount} endpoints
                        </p>
                      ))
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={onCancel}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onComplete(summary)}
                    >
                      View Endpoints
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onComplete(summary)}
                    >
                      Compare Branches
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {renderPhase(1)}

                  <div className="space-y-2">
                    {renderPhase(2)}
                    {processingFile ? (
                      <p className="text-sm text-slate-300">
                        📋 Processing: {processingFile} <span className="blink-cursor">|</span>
                      </p>
                    ) : null}
                    {waitingFiles.slice(0, 2).map((fileName) => (
                      <p key={fileName} className="text-sm text-slate-500">
                        📋 Processing: {fileName} ⏳ Waiting
                      </p>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {renderPhase(3)}

                    <div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full bg-brand-600 transition-all duration-500 ease-out"
                          style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
                        />
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{progress.percent}%</p>
                      <p className="text-sm text-slate-400">
                        Extracted {progress.current} of {progress.total} endpoints
                      </p>
                    </div>
                  </div>

                  {streamError ? <p className="text-sm text-red-400">{streamError}</p> : null}
                </>
              )}
            </div>

            {!summary && (
              <footer className="flex items-center justify-end gap-2 border-t border-slate-700/70 px-5 py-4">
                <button type="button" className="btn-secondary" onClick={closeAndCancel}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={setBackground}>
                  Background
                </button>
              </footer>
            )}
          </div>
        </div>
      )}

      {isBackgroundMode && !summary && (
        <div className="fixed bottom-4 right-4 z-30 w-[320px] rounded-xl border border-slate-700 bg-dark-800 p-4 shadow-xl">
          <p className="text-sm font-medium text-white">🔄 Scanning {branchName} {progress.percent}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-brand-600 transition-all duration-500 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={showModal}>
              View Details
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-green-500/30 bg-dark-800 px-4 py-3 text-sm text-green-400 shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
};

export default ScanProgress;
