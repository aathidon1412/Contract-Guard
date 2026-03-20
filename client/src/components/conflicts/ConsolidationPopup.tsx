import { useState } from "react";

interface ConsolidationOption {
  value: string;
  label: string;
  description?: string;
  consequence?: string;
  recommended?: boolean;
}

interface ConsolidationConflict {
  id: string;
  scenarioType:
    | "BOTH_REMOVE"
    | "BOTH_MODIFY_DIFFERENTLY"
    | "ONE_REMOVES_ONE_RENAMES"
    | "BOTH_ADD_DIFFERENTLY"
    | "ONE_REMOVES_OTHER_MODIFIES";
  fieldName: string;
  endpoint: string;
  method: string;
  branchAName: string;
  branchBName: string;
  branchAAction: string;
  branchBAction: string;
  description: string;
  subOptions: ConsolidationOption[];
  autoResolvable: boolean;
  autoResolution: string | null;
}

interface Props {
  scenario: ConsolidationConflict;
  onResolve: (id: string, option: string) => void;
  onSkip: () => void;
  index?: number;
  total?: number;
}

function OptionRow({
  option,
  selected,
  onSelect,
}: {
  option: ConsolidationOption;
  selected: boolean;
  onSelect: (v: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(option.value)}
      className={`w-full text-left rounded-lg p-3 border transition flex items-center justify-between hover:shadow-md ${
        selected
          ? "border-green-500 bg-green-900/10 ring-2 ring-green-400/30"
          : "border-slate-700 bg-dark-900"
      }`}
    >
      <div>
        <div className="flex items-center gap-2">
          {selected ? <span className="text-green-400">✓</span> : <span className="w-4" />}
          <div className="font-medium text-sm text-white">{option.label}</div>
        </div>
        {option.description && <div className="text-xs text-slate-400 mt-1">{option.description}</div>}
      </div>
      {option.consequence && <div className="text-xs text-slate-400">{option.consequence}</div>}
    </button>
  );
}

export default function ConsolidationPopup({ scenario, onResolve, onSkip, index, total }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!selected) return;
    setIsConfirming(true);
    try {
      await onResolve(scenario.id, selected);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto rounded-lg border border-slate-700 bg-dark-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-lg">⚠️ Consolidation Conflict</div>
          {typeof index === "number" && typeof total === "number" && (
            <div className="text-sm text-slate-400">Scenario {index} of {total}</div>
          )}
        </div>
        <div className="text-sm text-slate-400">{scenario.scenarioType}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-400">Field</div>
          <div className="text-sm text-white">{scenario.fieldName}</div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-xs text-slate-400">Endpoint</div>
          <div className="text-sm text-white">{scenario.method} {scenario.endpoint}</div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-700 p-3 bg-dark-800">
          <div className="text-sm font-semibold text-white">{scenario.branchAName}</div>
          <div className="text-xs text-slate-300 mt-1">{scenario.branchAAction}</div>
        </div>
        <div className="rounded-lg border border-slate-700 p-3 bg-dark-800">
          <div className="text-sm font-semibold text-white">{scenario.branchBName}</div>
          <div className="text-xs text-slate-300 mt-1">{scenario.branchBAction}</div>
        </div>
      </div>

      {scenario.description && <div className="mb-4 text-sm text-slate-300">{scenario.description}</div>}

      <div className="space-y-3 mb-4">
        {scenario.subOptions.map((opt) => (
          <OptionRow key={opt.value} option={opt} selected={selected === opt.value} onSelect={setSelected} />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={onSkip} className="text-sm text-slate-300">Skip for Now</button>
        <div className="flex items-center gap-2">
          <button onClick={() => setSelected(null)} className="text-sm text-slate-400">Clear</button>
          <button
            onClick={handleConfirm}
            disabled={!selected || isConfirming}
            className={`rounded px-4 py-2 text-sm font-medium ${
              selected ? "bg-green-600 text-white" : "bg-slate-700 text-slate-300 opacity-60"
            }`}
          >
            {isConfirming ? "Confirming..." : "Confirm Resolution ▶"}
          </button>
        </div>
      </div>
    </div>
  );
}
