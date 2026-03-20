import { v4 as uuid } from "uuid";
import { Severity } from "./severityCalculator";

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

interface BranchConflictResult {
  branchId: number;
  branchName: string;
  conflicts: DetectedConflict[];
  conflictCount: number;
  severity: Severity;
}

interface ConsolidationOption {
  value: string;
  label: string;
  description?: string;
  consequence?: string;
  recommended: boolean;
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

function makeOption(o: ConsolidationOption): ConsolidationOption {
  return o;
}

function makeConflictEntry(partial: Omit<ConsolidationConflict, "id">): ConsolidationConflict {
  return { id: uuid(), ...partial };
}

function analyzeConsolidation(branchResults: BranchConflictResult[]): ConsolidationConflict[] {
  const results: ConsolidationConflict[] = [];

  // compare each pair of branches
  for (let i = 0; i < branchResults.length; i++) {
    for (let j = i + 1; j < branchResults.length; j++) {
      const A = branchResults[i];
      const B = branchResults[j];

      // Map conflicts by endpoint+field for quick lookup
      const mapA = new Map<string, DetectedConflict[]>();
      for (const c of A.conflicts) {
        const key = `${c.endpoint}::${c.method}::${(c.fieldName || "").toString()}`;
        if (!mapA.has(key)) mapA.set(key, []);
        mapA.get(key)!.push(c);
      }

      const mapB = new Map<string, DetectedConflict[]>();
      for (const c of B.conflicts) {
        const key = `${c.endpoint}::${c.method}::${(c.fieldName || "").toString()}`;
        if (!mapB.has(key)) mapB.set(key, []);
        mapB.get(key)!.push(c);
      }

      // examine keys present in either
      const keys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
      for (const key of keys) {
        const [endpoint, method, fieldName] = key.split("::");
        const aList = mapA.get(key) || [];
        const bList = mapB.get(key) || [];

        // We'll analyze first conflict from each list when multiple exist
        const a = aList[0] ?? null;
        const b = bList[0] ?? null;

        if (!a || !b) {
          // Handle cases where endpoint-level conflicts exist without fieldName
          // Example: one branch removed endpoint, other modified field within it
          // Look for endpoint-level keys (fieldName may be empty)
          if (a && !b) {
            // check if branch B has any conflict on same endpoint (different field)
            const bEndpointConflicts = B.conflicts.filter((c) => c.endpoint === endpoint && c.method === method);
            if (bEndpointConflicts.length > 0) {
              // ONE_REMOVES_OTHER_MODIFIES
              if (a.type === "ENDPOINT_REMOVED") {
                results.push(
                  makeConflictEntry({
                    scenarioType: "ONE_REMOVES_OTHER_MODIFIES",
                    fieldName: fieldName || "",
                    endpoint,
                    method,
                    branchAName: A.branchName,
                    branchBName: B.branchName,
                    branchAAction: "remove endpoint",
                    branchBAction: "modify endpoint",
                    description: `Branch ${B.branchName} modifies an endpoint ${endpoint} ${method} that ${A.branchName} removes`,
                    subOptions: [
                      makeOption({ value: "keep_endpoint", label: "Keep endpoint with B changes", description: "", consequence: "B changes preserved", recommended: true }),
                      makeOption({ value: "remove_endpoint", label: "Remove endpoint (A wins)", description: "", consequence: "Endpoint removed", recommended: false }),
                    ],
                    autoResolvable: false,
                    autoResolution: null,
                  })
                );
              }
            }
          }
          if (b && !a) {
            const aEndpointConflicts = A.conflicts.filter((c) => c.endpoint === endpoint && c.method === method);
            if (aEndpointConflicts.length > 0) {
              if (b.type === "ENDPOINT_REMOVED") {
                results.push(
                  makeConflictEntry({
                    scenarioType: "ONE_REMOVES_OTHER_MODIFIES",
                    fieldName: fieldName || "",
                    endpoint,
                    method,
                    branchAName: A.branchName,
                    branchBName: B.branchName,
                    branchAAction: "modify endpoint",
                    branchBAction: "remove endpoint",
                    description: `Branch ${A.branchName} modifies an endpoint ${endpoint} ${method} that ${B.branchName} removes`,
                    subOptions: [
                      makeOption({ value: "keep_endpoint", label: "Keep endpoint with A changes", description: "", consequence: "A changes preserved", recommended: true }),
                      makeOption({ value: "remove_endpoint", label: "Remove endpoint (B wins)", description: "", consequence: "Endpoint removed", recommended: false }),
                    ],
                    autoResolvable: false,
                    autoResolution: null,
                  })
                );
              }
            }
          }
          continue;
        }

        // Now both a and b exist for same endpoint+field
        // Normalize simple action descriptions
        const actionA = a.type;
        const actionB = b.type;

        // BOTH_REMOVE: both remove same field
        if (actionA === "FIELD_REMOVED" && actionB === "FIELD_REMOVED") {
          results.push(
            makeConflictEntry({
              scenarioType: "BOTH_REMOVE",
              fieldName: fieldName || a.fieldName,
              endpoint,
              method,
              branchAName: A.branchName,
              branchBName: B.branchName,
              branchAAction: "remove field",
              branchBAction: "remove field",
              description: `Both branches agree to remove ${fieldName || a.fieldName}`,
              subOptions: [],
              autoResolvable: true,
              autoResolution: "remove",
            })
          );
          continue;
        }

        // ONE_REMOVES_ONE_RENAMES
        if ((actionA === "FIELD_REMOVED" && actionB === "FIELD_RENAMED") || (actionB === "FIELD_REMOVED" && actionA === "FIELD_RENAMED")) {
          const useA = actionA === "FIELD_REMOVED";
          results.push(
            makeConflictEntry({
              scenarioType: "ONE_REMOVES_ONE_RENAMES",
              fieldName: fieldName || (useA ? a.fieldName : b.fieldName),
              endpoint,
              method,
              branchAName: A.branchName,
              branchBName: B.branchName,
              branchAAction: useA ? "remove field" : `rename to ${a.branchValue}`,
              branchBAction: useA ? `rename to ${b.branchValue}` : "remove field",
              description: `One branch removes ${fieldName} while the other renames it`,
              subOptions: [
                makeOption({ value: "keep_main", label: "Keep Original Name", description: "Both changes reverted", consequence: "Both changes reverted", recommended: false }),
                makeOption({ value: "use_rename", label: `Use ${useA ? b.branchValue : a.branchValue} (${useA ? B.branchName : A.branchName} wins)`, description: "", consequence: "Rename applied, removal ignored", recommended: true }),
                makeOption({ value: "use_removal", label: "Remove field (removal wins)", description: "", consequence: "Field removed", recommended: false }),
              ],
              autoResolvable: false,
              autoResolution: null,
            })
          );
          continue;
        }

        // BOTH_MODIFY_DIFFERENTLY: e.g., TYPE_CHANGED to different types
        if (actionA === "TYPE_CHANGED" && actionB === "TYPE_CHANGED" && a.branchValue !== b.branchValue) {
          results.push(
            makeConflictEntry({
              scenarioType: "BOTH_MODIFY_DIFFERENTLY",
              fieldName: fieldName || a.fieldName,
              endpoint,
              method,
              branchAName: A.branchName,
              branchBName: B.branchName,
              branchAAction: a.branchValue,
              branchBAction: b.branchValue,
              description: `Both branches modify ${fieldName} differently (${A.branchName}: ${a.branchValue}, ${B.branchName}: ${b.branchValue})`,
              subOptions: [
                makeOption({ value: "keep_main", label: "Keep Original", description: "Both branch changes reverted", consequence: "Both branch changes reverted", recommended: false }),
                makeOption({ value: "use_branch_a", label: `Use ${A.branchName} value`, description: "", consequence: `Discard ${B.branchName} change`, recommended: false }),
                makeOption({ value: "use_branch_b", label: `Use ${B.branchName} value`, description: "", consequence: `Discard ${A.branchName} change`, recommended: false }),
              ],
              autoResolvable: false,
              autoResolution: null,
            })
          );
          continue;
        }

        // BOTH_ADD_DIFFERENTLY: both add same field differently (we detect REQUIRED_ADDED in both)
        if (actionA === "REQUIRED_ADDED" && actionB === "REQUIRED_ADDED") {
          results.push(
            makeConflictEntry({
              scenarioType: "BOTH_ADD_DIFFERENTLY",
              fieldName: fieldName || a.fieldName,
              endpoint,
              method,
              branchAName: A.branchName,
              branchBName: B.branchName,
              branchAAction: "added",
              branchBAction: "added",
              description: `Both branches add ${fieldName} with different characteristics`,
              subOptions: [
                makeOption({ value: "required", label: "Add as required (Branch A)", description: "", consequence: "Field added as required", recommended: false }),
                makeOption({ value: "optional", label: "Add as optional (Branch B)", description: "", consequence: "Field added as optional", recommended: true }),
                makeOption({ value: "keep_main", label: "Do not add field", description: "", consequence: "Field not added", recommended: false }),
              ],
              autoResolvable: false,
              autoResolution: null,
            })
          );
          continue;
        }

        // Fallback: if both modified in different ways not captured above, treat as BOTH_MODIFY_DIFFERENTLY
        if (actionA !== actionB) {
          results.push(
            makeConflictEntry({
              scenarioType: "BOTH_MODIFY_DIFFERENTLY",
              fieldName: fieldName || a.fieldName || b.fieldName,
              endpoint,
              method,
              branchAName: A.branchName,
              branchBName: B.branchName,
              branchAAction: actionA,
              branchBAction: actionB,
              description: `Branches modify ${fieldName || a.fieldName || b.fieldName} differently (${actionA} vs ${actionB})`,
              subOptions: [
                makeOption({ value: "keep_main", label: "Keep Original", description: "Both changes reverted", consequence: "Both branch changes reverted", recommended: false }),
                makeOption({ value: "use_branch_a", label: `Use ${A.branchName} change`, description: "", consequence: `Discard ${B.branchName} change`, recommended: false }),
                makeOption({ value: "use_branch_b", label: `Use ${B.branchName} change`, description: "", consequence: `Discard ${A.branchName} change`, recommended: false }),
              ],
              autoResolvable: false,
              autoResolution: null,
            })
          );
        }
      }
    }
  }

  // Return sorted: non-autoResolvable first
  results.sort((a, b) => Number(a.autoResolvable) - Number(b.autoResolvable));
  return results;
}

export type { ConsolidationConflict, ConsolidationOption };
export default analyzeConsolidation;
