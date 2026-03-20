import axios from "axios";
import { Conflict, CrossBranchScenario } from "@prisma/client";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:32b";
const OLLAMA_TIMEOUT = 120000;

const OLLAMA_OFFLINE_FALLBACK = "__OLLAMA_OFFLINE__";

const callOllama = async (prompt: string): Promise<string> => {
  const startedAt = Date.now();

  try {
    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 512,
        },
      },
      {
        timeout: OLLAMA_TIMEOUT,
      }
    );

    const elapsed = Date.now() - startedAt;
    console.log(`✅ qwen2.5-coder:32b responded in ${elapsed}ms`);

    return typeof response.data?.response === "string"
      ? response.data.response
      : OLLAMA_OFFLINE_FALLBACK;
  } catch (error) {
    console.warn("⚠️ Ollama offline — using fallback response", error);
    return OLLAMA_OFFLINE_FALLBACK;
  }
};

const checkOllamaStatus = async (): Promise<
  | { available: false }
  | {
      available: boolean;
      model: string;
      modelLoaded: boolean;
      url: string;
    }
> => {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 15000,
    });

    const models: Array<{ name?: string }> = response.data?.models ?? [];
    const modelLoaded = models.some((entry) => entry.name === OLLAMA_MODEL);

    return {
      available: true,
      model: OLLAMA_MODEL,
      modelLoaded,
      url: OLLAMA_URL,
    };
  } catch {
    return { available: false };
  }
};

const explainConflict = async (conflict: Conflict): Promise<string> => {
  const status = await checkOllamaStatus();
  if (!status.available) {
    console.warn("⚠️ Ollama offline — using fallback response");
    return "AI explanation unavailable. Start Ollama to get explanations.";
  }

  const prompt = `You are an API conflict detection expert.
Explain this API conflict in exactly 3 sentences.
Sentence 1: What changed.
Sentence 2: What will break if not fixed.
Sentence 3: How serious it is.
Do not use JSON. Do not use code blocks.
Keep it simple for any developer to understand.

Conflict Type: ${conflict.type}
Field Name: ${conflict.fieldName}
Endpoint: ${conflict.method} ${conflict.endpoint}
Original (main): ${conflict.mainValue}
Changed (branch): ${conflict.branchValue}
Impact Level: ${conflict.impactLevel}
Branch: ${conflict.branchName}`;

  console.log("🤖 Calling qwen2.5-coder:32b for explainConflict...");
  const response = await callOllama(prompt);

  if (response === OLLAMA_OFFLINE_FALLBACK) {
    return "AI explanation unavailable. Start Ollama to get explanations.";
  }

  return response;
};

const suggestResolution = async (
  conflict: Conflict
): Promise<{ suggestion: string; reason: string }> => {
  const status = await checkOllamaStatus();
  if (!status.available) {
    console.warn("⚠️ Ollama offline — using fallback response");
    return {
      suggestion: "keep_main",
      reason: "AI offline — defaulting to safe option",
    };
  }

  const prompt = `For this API conflict choose the safest resolution.
You must pick ONLY one of these three options:
1. keep_main → revert the branch change
2. use_branch → accept the branch change
3. make_optional → keep field but make it optional

Respond in this exact format only:
OPTION: [option_name]
REASON: [one sentence reason]

Conflict Type: ${conflict.type}
Field: ${conflict.fieldName}
Main value: ${conflict.mainValue}
Branch value: ${conflict.branchValue}
Impact: ${conflict.impactLevel}`;

  console.log("🤖 Calling qwen2.5-coder:32b for suggestResolution...");
  const response = await callOllama(prompt);

  if (response === OLLAMA_OFFLINE_FALLBACK) {
    return {
      suggestion: "keep_main",
      reason: "AI offline — defaulting to safe option",
    };
  }

  const optionMatch = response.match(/OPTION:\s*([a-z_]+)/i);
  const reasonMatch = response.match(/REASON:\s*(.+)/i);

  return {
    suggestion: optionMatch?.[1]?.toLowerCase() || "keep_main",
    reason: reasonMatch?.[1]?.trim() || "AI offline — defaulting to safe option",
  };
};

const explainScenario = async (scenario: CrossBranchScenario): Promise<string> => {
  const status = await checkOllamaStatus();
  if (!status.available) {
    console.warn("⚠️ Ollama offline — using fallback response");
    return "AI explanation unavailable. Start Ollama to get scenario analysis.";
  }

  const branchesInvolved = Array.isArray(scenario.involvedBranches)
    ? scenario.involvedBranches.join(", ")
    : String(scenario.involvedBranches);

  const prompt = `Explain this cross-branch API scenario
in 3 simple sentences for a developer.
Sentence 1: What is happening between the branches.
Sentence 2: What is the risk if both branches merge.
Sentence 3: What is the safest action to take.
No JSON. No code blocks. Plain English only.

Scenario Type: ${scenario.scenarioType}
Affected Field: ${scenario.fieldName}
Affected Endpoint: ${scenario.affectedEndpoint}
Branches Involved: ${branchesInvolved}`;

  console.log("🤖 Calling qwen2.5-coder:32b for explainScenario...");
  const response = await callOllama(prompt);

  if (response === OLLAMA_OFFLINE_FALLBACK) {
    return "AI explanation unavailable. Start Ollama to get scenario analysis.";
  }

  return response;
};

const generateMigrationGuide = async (
  conflicts: Conflict[],
  scenarios: CrossBranchScenario[]
): Promise<string> => {
  const status = await checkOllamaStatus();
  if (!status.available) {
    console.warn("⚠️ Ollama offline — using fallback response");
    return "# Migration Guide\nAI guide unavailable. Review conflicts manually.";
  }

  const prompt = `Write a developer migration guide for these API changes.
For each change write:
- What changed (one line)
- What the developer must update (one line)
- Example of the fix (one line)

Use this format for each item:
### [conflict type] — [field name]
Changed: [description]
Action: [what to do]
Example: [brief example]

API Changes:
${JSON.stringify(conflicts, null, 2)}

Cross-Branch Scenarios:
${JSON.stringify(scenarios, null, 2)}`;

  console.log("🤖 Calling qwen2.5-coder:32b for generateMigrationGuide...");
  const response = await callOllama(prompt);

  if (response === OLLAMA_OFFLINE_FALLBACK) {
    return "# Migration Guide\nAI guide unavailable. Review conflicts manually.";
  }

  return response;
};

const aiService = {
  callOllama,
  checkOllamaStatus,
  explainConflict,
  suggestResolution,
  explainScenario,
  generateMigrationGuide,
};

export default aiService;