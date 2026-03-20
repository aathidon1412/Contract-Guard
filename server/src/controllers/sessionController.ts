import { NextFunction, Request, Response } from "express";

import prisma from "../lib/prisma";
import AppError from "../utils/AppError";

const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { repoId, mainBranchId, branchIds } = req.body as {
      repoId?: number;
      mainBranchId?: number;
      branchIds?: number[];
    };

    if (!repoId || !mainBranchId || !Array.isArray(branchIds)) {
      throw new AppError("repoId, mainBranchId and branchIds are required", 400);
    }

    const session = await prisma.conflictSession.create({
      data: {
        repoId: Number(repoId),
        mainBranchId: Number(mainBranchId),
        branchIds,
        status: "draft",
      },
      include: {
        conflicts: true,
        scenarios: true,
      },
    });

    return res.status(201).json(session);
  } catch (error) {
    return next(error);
  }
};

const getOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);

    if (Number.isNaN(sessionId)) {
      throw new AppError("Invalid session id", 400);
    }

    const session = await prisma.conflictSession.findUnique({
      where: { id: sessionId },
      include: {
        conflicts: true,
        scenarios: true,
      },
    });

    if (!session) {
      throw new AppError("Session not found", 404);
    }

    return res.json(session);
  } catch (error) {
    return next(error);
  }
};

const finalize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);

    if (Number.isNaN(sessionId)) {
      throw new AppError("Invalid session id", 400);
    }

    const session = await prisma.conflictSession.findUnique({
      where: { id: sessionId },
      include: {
        conflicts: true,
        scenarios: true,
      },
    });

    if (!session) {
      throw new AppError("Session not found", 404);
    }

    const finalYaml = [
      "openapi: 3.0.0",
      "info:",
      `  title: ContractGuard Session ${session.id}`,
      "  version: 1.0.0",
      "paths: {}",
    ].join("\n");

    const migrationGuide = [
      `# Migration Guide for Session ${session.id}`,
      "",
      "1. Review all resolved conflicts.",
      "2. Validate merged endpoint contract changes.",
      "3. Regenerate client SDK if needed.",
    ].join("\n");

    await prisma.conflictSession.update({
      where: { id: sessionId },
      data: { status: "finalized" },
    });

    return res.json({
      sessionId,
      finalYaml,
      migrationGuide,
      diffLines: [],
    });
  } catch (error) {
    return next(error);
  }
};

const downloadYaml = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);

    if (Number.isNaN(sessionId)) {
      throw new AppError("Invalid session id", 400);
    }

    const session = await prisma.conflictSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Session not found", 404);
    }

    const yamlContent = [
      "openapi: 3.0.0",
      "info:",
      `  title: ContractGuard Session ${session.id}`,
      "  version: 1.0.0",
      "paths: {}",
    ].join("\n");

    res.setHeader("Content-Type", "text/yaml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=contractguard-session-${session.id}.yaml`
    );

    return res.send(yamlContent);
  } catch (error) {
    return next(error);
  }
};

const downloadGuide = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);

    if (Number.isNaN(sessionId)) {
      throw new AppError("Invalid session id", 400);
    }

    const session = await prisma.conflictSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Session not found", 404);
    }

    const guideContent = [
      `# Migration Guide for Session ${session.id}`,
      "",
      "1. Review all resolved conflicts.",
      "2. Validate merged endpoint contract changes.",
      "3. Deploy and monitor post-release behavior.",
    ].join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=contractguard-session-${session.id}-guide.txt`
    );

    return res.send(guideContent);
  } catch (error) {
    return next(error);
  }
};

export default {
  create,
  getOne,
  finalize,
  downloadYaml,
  downloadGuide,
};