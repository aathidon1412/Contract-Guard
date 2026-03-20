export type Severity = "Critical" | "High" | "Medium" | "Low" | "Easy";

export type ConflictType =
  | "ENDPOINT_REMOVED"
  | "ENDPOINT_ADDED"
  | "FIELD_REMOVED"
  | "FIELD_RENAMED"
  | "TYPE_CHANGED"
  | "REQUIRED_ADDED"
  | "REQUIRED_REMOVED"
  | "FIELD_ADDED";

/**
 * Calculate a conflict severity based on type, whether a field is required,
 * and how many branches are affected.
 */
function calculateSeverity(
  conflictType: ConflictType,
  fieldRequired: boolean,
  affectedBranchCount: number
): Severity {
  let severity: Severity;

  switch (conflictType) {
    case "ENDPOINT_REMOVED":
      severity = "Critical";
      break;

    case "FIELD_REMOVED":
      severity = fieldRequired ? "Critical" : "Medium";
      break;

    case "FIELD_RENAMED":
      severity = "High";
      break;

    case "TYPE_CHANGED":
      severity = "High";
      break;

    case "REQUIRED_ADDED":
      severity = "Medium";
      break;

    case "REQUIRED_REMOVED":
      severity = "Low";
      break;

    case "ENDPOINT_ADDED":
      severity = "Easy";
      break;

    case "FIELD_ADDED":
      // Rule: FIELD_ADDED (optional) -> Easy. If the added field is required,
      // treat as Medium by default.
      severity = fieldRequired ? "Medium" : "Easy";
      break;

    default:
      severity = "Medium";
  }

  // Extra rule: if 3 or more branches affected and severity is High, upgrade to Critical
  if (affectedBranchCount >= 3 && severity === "High") {
    severity = "Critical";
  }

  return severity;
}

export default calculateSeverity;
