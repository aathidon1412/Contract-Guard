import { useMemo, useState } from "react";

import type { Repository } from "../../types";

interface DeleteConfirmModalProps {
  repo: Repository;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

const DeleteConfirmModal = ({ repo, onConfirm, onCancel, isDeleting }: DeleteConfirmModalProps) => {
  const [confirmName, setConfirmName] = useState("");

  const isMatch = useMemo(() => confirmName === repo.name, [confirmName, repo.name]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-dark-800 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700/70 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">🗑️ Remove Repository</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
            aria-label="Close"
            disabled={isDeleting}
          >
            ×
          </button>
        </header>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-slate-200">
            Are you sure you want to remove
            <span className="ml-1 font-semibold text-white">📁 {repo.name}</span>
            <span className="ml-1">from ContractGuard?</span>
          </p>

          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="font-medium text-red-300">⚠️ This will permanently delete:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-red-200">
              <li>All scanned branch data</li>
              <li>All extracted API endpoints</li>
              <li>All conflict sessions</li>
              <li>All saved resolutions</li>
            </ul>
          </div>

          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-300">
            ✅ Your GitHub repository stays untouched
            <p className="text-green-200">This only removes it from ContractGuard.</p>
          </div>

          <div className="space-y-2">
            <p className="text-slate-200">Type the repository name to confirm:</p>
            <div className="relative">
              <input
                type="text"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={repo.name}
                className={`w-full rounded-lg border bg-dark-900 px-3 py-2 pr-9 text-sm text-white outline-none transition ${
                  confirmName.length === 0
                    ? "border-slate-700 focus:ring-1 focus:ring-brand-500"
                    : isMatch
                      ? "border-green-400 focus:ring-1 focus:ring-green-400"
                      : "border-red-400 focus:ring-1 focus:ring-red-400"
                }`}
                disabled={isDeleting}
              />
              {confirmName.length > 0 ? (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" aria-hidden="true">
                  {isMatch ? "✅" : "❌"}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-700/70 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isMatch || isDeleting}
            className={`rounded-lg px-4 py-2 font-medium transition-all ${
              !isMatch || isDeleting
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-red-500 text-white hover:bg-red-600"
            }`}
          >
            {isDeleting ? "⏳ Removing..." : "🗑️ Remove from ContractGuard"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
