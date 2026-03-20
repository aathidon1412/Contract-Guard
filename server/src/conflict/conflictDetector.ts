import calculateSeverity, { ConflictType, Severity } from "./severityCalculator";
import { v4 as uuid } from "uuid";

interface ResolutionOption {
  value: string;
  label: string;
  description?: string;
  recommended: boolean;
}

interface DetectedConflict {
  id: string;
  type: ConflictType;
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

// Minimal ApiEndpoint/Field types to operate in the detector
interface Field {
  name: string;
  type: string;
  required: boolean;
  lineNumber?: number;
}

interface ApiEndpoint {
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

function normalizeName(name: string) {
  return name.replace(/[_\-]/g, "").toLowerCase();
}

function isSimilarName(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;

  // camel vs snake: user_id vs userId -> normalized equal above

  // prefix overlap: common prefix length over longer name
  const minLen = Math.min(na.length, nb.length);
  let prefixLen = 0;
  for (let i = 0; i < minLen; i++) {
    if (na[i] === nb[i]) prefixLen++;
    else break;
  }

  const overlap = prefixLen / Math.max(na.length, nb.length);
  return overlap >= 0.7 || na.includes(nb) || nb.includes(na);
}

function findEndpoint(endpoints: ApiEndpoint[], path: string, method: string) {
  return endpoints.find((e) => e.path === path && e.method === method);
}

function allFields(ep: ApiEndpoint) {
  return [...(ep.requiredFields || []), ...(ep.optionalFields || [])];
}

function makeConflict(partial: Omit<DetectedConflict, "id" | "status">): DetectedConflict {
  return {
    id: uuid(),
    status: "unresolved",
    ...partial,
  } as DetectedConflict;
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

function detectConflicts(
  mainEndpoints: ApiEndpoint[],
  branchEndpoints: ApiEndpoint[],
  branchName: string
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];

  // STEP 1 — Endpoint removed check
  for (const mainEp of mainEndpoints) {
    const match = findEndpoint(branchEndpoints, mainEp.path, mainEp.method);
    if (!match) {
      const severity = calculateSeverity("ENDPOINT_REMOVED", true, 1);
      conflicts.push(
        makeConflict({
          type: "ENDPOINT_REMOVED",
          severity,
          endpoint: mainEp.path,
          method: mainEp.method,
          fieldName: "",
          mainValue: "",
          branchValue: "",
          branchName,
          lineMain: mainEp.lineStart || 0,
          lineBranch: 0,
          resolutionOptions: [
            {
              value: "keep_main",
              label: "Restore Endpoint",
              description: "Keep this endpoint from main",
              recommended: true,
            },
            {
              value: "use_branch",
              label: "Remove Endpoint",
              description: "Accept removal from branch",
              recommended: false,
            },
          ],
        })
      );
    }
  }

  // STEP 2 — Field level comparison for matching endpoints (find changes inside matching endpoints)
  for (const mainEp of mainEndpoints) {
    const branchEp = findEndpoint(branchEndpoints, mainEp.path, mainEp.method);
    if (!branchEp) continue;

    const mainFields = allFields(mainEp);
    const branchFields = allFields(branchEp);

    const renamedMap = new Map<string, string>(); // mainName -> branchName

    // Step 2 — Find fields in main NOT in branch (and detect renames)
    for (const mf of mainFields) {
      const exact = branchFields.find((bf) => bf.name === mf.name);
      if (exact) continue;

      // try to find a rename in branch
      const renamed = branchFields.find((bf) => isSimilarName(mf.name, bf.name));
      if (renamed) {
        renamedMap.set(mf.name, renamed.name);
        const severity = calculateSeverity("FIELD_RENAMED", false, 1) || "High" as Severity;
        conflicts.push(
          makeConflict({
            type: "FIELD_RENAMED",
            severity,
            endpoint: mainEp.path,
            method: mainEp.method,
            fieldName: mf.name,
            mainValue: `${mf.name}: ${mf.type}`,
            branchValue: `${renamed.name}: ${renamed.type}`,
            branchName,
            lineMain: mf.lineNumber ?? mainEp.lineStart ?? 0,
            lineBranch: renamed.lineNumber ?? branchEp.lineStart ?? 0,
            resolutionOptions: [
              { value: "keep_main", label: "Keep Original Name", recommended: true },
              { value: "use_branch", label: "Use New Name", recommended: false },
              { value: "keep_both", label: "Keep Both as Aliases", recommended: false },
            ],
          })
        );
      } else {
        // not found and not renamed -> removed
        const severity = mf.required ? ("Critical" as Severity) : ("Medium" as Severity);
        conflicts.push(
          makeConflict({
            type: "FIELD_REMOVED",
            severity,
            endpoint: mainEp.path,
            method: mainEp.method,
            fieldName: mf.name,
            mainValue: `${mf.name}: ${mf.type}`,
            branchValue: "",
            branchName,
            lineMain: mf.lineNumber ?? mainEp.lineStart ?? 0,
            lineBranch: 0,
            resolutionOptions: [
              { value: "keep_main", label: "Keep Field", recommended: true },
              { value: "use_branch", label: "Remove Field", recommended: false },
              { value: "make_optional", label: "Make Optional", recommended: false },
            ],
          })
        );
      }
    }

    // Step 3 — Find fields in branch NOT in main (skip ones already identified as renames)
    for (const bf of branchFields) {
      const exact = mainFields.find((mf) => mf.name === bf.name);
      if (exact) continue;
      // if this branch field was used as a rename target, skip
      if (Array.from(renamedMap.values()).includes(bf.name)) continue;

      if (bf.required) {
        // REQUIRED_ADDED
        const severity = ("Medium" as Severity);
        conflicts.push(
          makeConflict({
            type: "REQUIRED_ADDED",
            severity,
            endpoint: mainEp.path,
            method: mainEp.method,
            fieldName: bf.name,
            mainValue: "field does not exist",
            branchValue: `${bf.name} (required)`,
            branchName,
            lineMain: 0,
            lineBranch: bf.lineNumber ?? branchEp.lineStart ?? 0,
            resolutionOptions: [
              { value: "keep_main", label: "Remove Addition", recommended: false },
              { value: "use_branch", label: "Accept Addition", recommended: true },
              { value: "make_optional", label: "Make Optional", recommended: true },
            ],
          })
        );
      } else {
        // FIELD_ADDED
        const severity = ("Easy" as Severity);
        conflicts.push(
          makeConflict({
            type: "FIELD_ADDED",
            severity,
            endpoint: mainEp.path,
            method: mainEp.method,
            fieldName: bf.name,
            mainValue: "",
            branchValue: bf.name,
            branchName,
            lineMain: 0,
            lineBranch: bf.lineNumber ?? branchEp.lineStart ?? 0,
            resolutionOptions: [
              { value: "use_branch", label: "Use New Field", recommended: true },
              { value: "ignore", label: "Ignore", recommended: false },
            ],
          })
        );
      }
    }

    // Step 4 — Find type changes for fields present in both
    for (const mf of mainFields) {
      const bf = branchFields.find((b) => b.name === mf.name);
      if (bf && bf.type && mf.type && bf.type !== mf.type) {
        const severity = ("High" as Severity);
        conflicts.push(
          makeConflict({
            type: "TYPE_CHANGED",
            severity,
            endpoint: mainEp.path,
            method: mainEp.method,
            fieldName: mf.name,
            mainValue: `${mf.name}: ${mf.type}`,
            branchValue: `${bf.name}: ${bf.type}`,
            branchName,
            lineMain: mf.lineNumber ?? mainEp.lineStart ?? 0,
            lineBranch: bf.lineNumber ?? branchEp.lineStart ?? 0,
            resolutionOptions: [
              { value: "keep_main", label: "Keep Original Type", recommended: true },
              { value: "use_branch", label: "Use New Type", recommended: false },
            ],
          })
        );
      }
    }
  }

  // STEP 4 — New endpoint check
  for (const branchEp of branchEndpoints) {
    const match = findEndpoint(mainEndpoints, branchEp.path, branchEp.method);
    if (!match) {
      const severity = calculateSeverity("ENDPOINT_ADDED", false, 1);
      conflicts.push(
        makeConflict({
          type: "ENDPOINT_ADDED",
          severity,
          endpoint: branchEp.path,
          method: branchEp.method,
          fieldName: "",
          mainValue: "",
          branchValue: "",
          branchName,
          lineMain: 0,
          lineBranch: branchEp.lineStart ?? 0,
          resolutionOptions: [
            {
              value: "use_branch",
              label: "Add New Endpoint",
              description: "",
              recommended: true,
            },
            {
              value: "keep_main",
              label: "Ignore",
              description: "",
              recommended: false,
            },
          ],
        })
      );
    }
  }

  // STEP 5 — Sort by severity
  conflicts.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  // STEP 6 — IDs already assigned by makeConflict

  return conflicts;
}

export default detectConflicts;
