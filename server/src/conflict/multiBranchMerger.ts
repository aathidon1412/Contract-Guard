import detectConflicts from "./conflictDetector";
import { v4 as uuid } from "uuid";
import { Severity } from "./severityCalculator";

interface Field {
  name: string;
  type: string;
  required: boolean;
  lineNumber?: number;
}

export interface ApiEndpoint {
  id?: number;
  branchId?: number;
  path: string;
  method: string;
  lineStart: number;
  lineEnd?: number;
  requiredFields: Field[];
  optionalFields: Field[];
  responseFields?: Field[];
  fileName?: string;
}

interface ResolutionOption {
  value: string;
  label: string;
  description?: string;
  recommended: boolean;
}

interface DetectedConflict {
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
  status: "unresolved";
  resolutionOptions: ResolutionOption[];
}

interface BranchInput {
  id: number;
  name: string;
  endpoints: ApiEndpoint[];
}

interface BranchConflictResult {
  branchId: number;
  branchName: string;
  conflicts: DetectedConflict[];
  conflictCount: number;
  severity: Severity;
}

interface MultiBranchResult {
  sessionId: string;
  totalConflicts: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  easyCount: number;
  overallSeverity: Severity;
  branchResults: BranchConflictResult[];
  consolidationNeeded: boolean;
}

function severityOrder(s: Severity) {
  switch (s) {
    case "Critical":
      return 0;
    case "High":
      return 1;
    case "Medium":
      return 2;
    case "Low":
      return 3;
    case "Easy":
      return 4;
    default:
      return 5;
  }
}

function highestSeverity(conflicts: DetectedConflict[]): Severity {
  if (!conflicts || conflicts.length === 0) return "Easy";
  return conflicts.reduce((best, c) => {
    return severityOrder(c.severity) < severityOrder(best) ? c.severity : best;
  }, "Easy" as Severity);
}

function severityCounts(conflicts: DetectedConflict[]) {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Easy: 0 } as Record<string, number>;
  for (const c of conflicts) {
    counts[c.severity] = (counts[c.severity] || 0) + 1;
  }
  return counts;
}

function detectAllBranchConflicts(
  mainEndpoints: ApiEndpoint[],
  branches: BranchInput[]
): MultiBranchResult {
  const sessionId = uuid();
  const branchResults: BranchConflictResult[] = [];
  const allConflicts: DetectedConflict[] = [];

  for (const br of branches) {
    const conflicts = detectConflicts(mainEndpoints, br.endpoints || [], br.name);
    const bc: BranchConflictResult = {
      branchId: br.id,
      branchName: br.name,
      conflicts,
      conflictCount: conflicts.length,
      severity: highestSeverity(conflicts),
    };
    branchResults.push(bc);
    allConflicts.push(...conflicts.map((c) => ({ ...c, branchName: br.name })));
  }

  const counts = severityCounts(allConflicts);
  const totalConflicts = allConflicts.length;

  let overallSeverity: Severity = "Easy";
  if (counts["Critical"] > 0) overallSeverity = "Critical";
  else if (counts["High"] > 0) overallSeverity = "High";
  else if (counts["Medium"] > 0) overallSeverity = "Medium";
  else if (counts["Low"] > 0) overallSeverity = "Low";
  else overallSeverity = "Easy";

  // Consolidation needed: detect same endpoint or same field across 2+ branches
  const endpointMap = new Map<string, Set<number>>();
  const fieldMap = new Map<string, Set<number>>();

  for (const br of branchResults) {
    const id = br.branchId;
    const seenEndpoints = new Set<string>();
    const seenFields = new Set<string>();
    for (const c of br.conflicts) {
      const epKey = `${c.endpoint}::${c.method}`;
      if (!seenEndpoints.has(epKey)) {
        seenEndpoints.add(epKey);
        if (!endpointMap.has(epKey)) endpointMap.set(epKey, new Set());
        endpointMap.get(epKey)!.add(id);
      }

      if (c.fieldName && c.fieldName.trim() !== "") {
        const fieldKey = `${c.endpoint}::${c.method}::${c.fieldName}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          if (!fieldMap.has(fieldKey)) fieldMap.set(fieldKey, new Set());
          fieldMap.get(fieldKey)!.add(id);
        }
      }
    }
  }

  let consolidationNeeded = false;
  for (const s of endpointMap.values()) {
    if (s.size >= 2) {
      consolidationNeeded = true;
      break;
    }
  }
  if (!consolidationNeeded) {
    for (const s of fieldMap.values()) {
      if (s.size >= 2) {
        consolidationNeeded = true;
        break;
      }
    }
  }

  const result: MultiBranchResult = {
    sessionId,
    totalConflicts,
    criticalCount: counts["Critical"] || 0,
    highCount: counts["High"] || 0,
    mediumCount: counts["Medium"] || 0,
    lowCount: counts["Low"] || 0,
    easyCount: counts["Easy"] || 0,
    overallSeverity,
    branchResults,
    consolidationNeeded,
  };

  return result;
}

export default detectAllBranchConflicts;
