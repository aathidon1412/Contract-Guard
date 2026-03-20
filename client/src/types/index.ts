export interface Repository {
  id: number
  name: string
  fullName: string
  githubUrl: string
  description?: string
  language?: string
  totalApis: number
  status: string
  lastScanned?: string
  branches: Branch[]
}

export interface Branch {
  id: number
  repoId: number
  name: string
  type: "main" | "branch"
  totalApis: number
  scanStatus: "pending" | "scanning" | "ready" | "failed"
  lastScanned?: string
  endpoints?: ApiEndpoint[]
}

export interface ApiEndpoint {
  id: number
  branchId: number
  path: string
  method: string
  lineStart: number
  lineEnd: number
  requiredFields: Field[]
  optionalFields: Field[]
  responseFields: Field[]
  fileName: string
}

export interface Field {
  name: string
  type: string
  required: boolean
  lineNumber?: number
}

export interface Conflict {
  id: number
  sessionId: number
  type: string
  fieldName: string
  endpoint: string
  method: string
  mainValue: string
  branchValue: string
  impactLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  resolution?: string
  lineMain: number
  lineBranch: number
  branchName: string
  status: "unresolved" | "resolved"
}

export interface CrossBranchScenario {
  id: number
  sessionId: number
  scenarioType: string
  fieldName: string
  affectedEndpoint: string
  involvedBranches: string[]
  popupRequired: boolean
  autoResolved: boolean
  chosenOption?: string
  status: "pending" | "resolved"
}

export interface ConflictSession {
  id: number
  repoId: number
  mainBranchId: number
  branchIds: number[]
  status: string
  conflicts: Conflict[]
  scenarios: CrossBranchScenario[]
}