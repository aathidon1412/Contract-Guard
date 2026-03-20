import { Request, Response } from "express";
import { Conflict, CrossBranchScenario } from "@prisma/client";

import aiService from "../services/aiService";

const MODEL_NAME = "qwen2.5-coder:32b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const getStatus = async (_req: Request, res: Response) => {
  const status = await aiService.checkOllamaStatus();

  if (!status.available) {
    return res.json({
      available: false,
      model: MODEL_NAME,
      modelLoaded: false,
      url: OLLAMA_URL,
      message: "Offline",
    });
  }

  return res.json({
    available: status.available,
    model: MODEL_NAME,
    modelLoaded: status.modelLoaded,
    url: status.url,
    message: status.modelLoaded ? "Ready" : "Model not loaded",
  });
};

const explainConflict = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const conflict = req.body?.conflict as Partial<Conflict> | undefined;

  if (!conflict?.type || !conflict?.fieldName) {
    return res.status(400).json({ error: "Conflict data required" });
  }

  const explanation = await aiService.explainConflict(conflict as Conflict);
  const elapsed = Date.now() - startedAt;
  console.log(`explainConflict request completed in ${elapsed}ms`);

  return res.json({ explanation });
};

const explainScenario = async (req: Request, res: Response) => {
  const scenario = req.body?.scenario as Partial<CrossBranchScenario> | undefined;

  if (!scenario?.scenarioType) {
    return res.status(400).json({ error: "Scenario data required" });
  }

  const explanation = await aiService.explainScenario(scenario as CrossBranchScenario);
  return res.json({ explanation });
};

const suggestResolution = async (req: Request, res: Response) => {
  const conflict = req.body?.conflict as Partial<Conflict> | undefined;

  if (!conflict) {
    return res.status(400).json({ error: "Conflict data required" });
  }

  const result = await aiService.suggestResolution(conflict as Conflict);
  return res.json(result);
};

const generateMigrationGuide = async (req: Request, res: Response) => {
  const conflicts = req.body?.conflicts as Conflict[] | undefined;
  const scenarios = (req.body?.scenarios as CrossBranchScenario[] | undefined) ?? [];

  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return res.status(400).json({ error: "No conflicts provided" });
  }

  const guide = await aiService.generateMigrationGuide(conflicts, scenarios);
  return res.json({ guide });
};

export default {
  getStatus,
  explainConflict,
  explainScenario,
  suggestResolution,
  generateMigrationGuide,
};