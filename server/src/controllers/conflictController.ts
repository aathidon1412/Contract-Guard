import { NextFunction, Request, Response } from "express";

import prisma from "../lib/prisma";
import AppError from "../utils/AppError";
import detectAllBranchConflicts from "../conflict/multiBranchMerger";
import analyzeConsolidation from "../conflict/consolidationAnalyzer";

// Helper to map DB ApiEndpoint rows into local shape expected by detectors
function mapEndpointRow(row: any) {
  return {
    id: row.id,
    branchId: row.branchId,
    path: row.path,
    method: row.method,
    lineStart: row.lineStart ?? 0,
    lineEnd: row.lineEnd ?? 0,
    requiredFields: Array.isArray(row.requiredFields) ? row.requiredFields : [],
    optionalFields: Array.isArray(row.optionalFields) ? row.optionalFields : [],
    responseFields: Array.isArray(row.responseFields) ? row.responseFields : [],
    fileName: row.fileName ?? "",
  };
}

function severityToImpact(sev: string) {
  return sev.toUpperCase();
}

const startDetection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { repoId, mainBranchId, branchIds } = req.body as {
      repoId?: number;
      mainBranchId?: number;
      branchIds?: number[];
    };

    if (!repoId || !mainBranchId || !Array.isArray(branchIds) || branchIds.length === 0) {
      throw new AppError("repoId, mainBranchId and branchIds are required", 400);
    }

    // Fetch main endpoints
    const mainRows = await prisma.apiEndpoint.findMany({ where: { branchId: Number(mainBranchId) } });
    const mainEndpoints = mainRows.map(mapEndpointRow);

    // Fetch branch endpoints and names
    const branches = [] as {
      id: number;
      name: string;
      endpoints: any[];
    }[];

    const branchRows = await prisma.branch.findMany({ where: { id: { in: branchIds } } });
    const branchMap = new Map<number, string>();
    for (const br of branchRows) {
      branchMap.set(br.id, br.name);
    }

    for (const bid of branchIds) {
      const rows = await prisma.apiEndpoint.findMany({ where: { branchId: Number(bid) } });
      branches.push({ id: bid, name: branchMap.get(bid) ?? `branch-${bid}`, endpoints: rows.map(mapEndpointRow) });
    }

    // Run detection
    const multiResult = detectAllBranchConflicts(mainEndpoints, branches as any);

    // Consolidation analysis when multiple branches
    let consolidationConflicts: any[] = [];
    if (branchIds.length > 1) {
      consolidationConflicts = analyzeConsolidation(multiResult.branchResults as any);
    }

    // Save ConflictSession
    const session = await prisma.conflictSession.create({
      data: {
        repoId: Number(repoId),
        mainBranchId: Number(mainBranchId),
        branchIds: branchIds,
        status: "active",
      },
    });

    // Save conflicts
    const createdConflicts: any[] = [];
    for (const br of multiResult.branchResults) {
      for (const c of br.conflicts) {
        const created = await prisma.conflict.create({
          data: {
            sessionId: session.id,
            type: c.type,
            fieldName: c.fieldName ?? "",
            endpoint: c.endpoint ?? "",
            method: c.method ?? "",
            mainValue: c.mainValue ?? "",
            branchValue: c.branchValue ?? "",
            impactLevel: severityToImpact(c.severity),
            lineMain: c.lineMain ?? 0,
            lineBranch: c.lineBranch ?? 0,
            branchName: c.branchName ?? br.branchName ?? "",
          },
        });
        createdConflicts.push(created);
      }
    }

    // Save consolidation scenarios
    const createdConsolidations: any[] = [];
    for (const cc of consolidationConflicts) {
      const created = await prisma.crossBranchScenario.create({
        data: {
          sessionId: session.id,
          scenarioType: cc.scenarioType,
          fieldName: cc.fieldName ?? "",
          affectedEndpoint: cc.endpoint ?? "",
          involvedBranches: [cc.branchAName, cc.branchBName],
          popupRequired: true,
          autoResolved: cc.autoResolvable ?? false,
          chosenOption: null,
          status: cc.autoResolvable ? "resolved" : "pending",
        },
      });
      createdConsolidations.push(created);
    }

    return res.json({
      sessionId: session.id,
      totalConflicts: multiResult.totalConflicts,
      criticalCount: multiResult.criticalCount,
      highCount: multiResult.highCount,
      mediumCount: multiResult.mediumCount,
      lowCount: multiResult.lowCount,
      easyCount: multiResult.easyCount,
      overallSeverity: multiResult.overallSeverity,
      branchResults: multiResult.branchResults,
      consolidationConflicts: createdConsolidations,
    });
  } catch (error) {
    return next(error);
  }
};

const resolveConflict = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conflictId, resolution, resolvedBy } = req.body as { conflictId?: number; resolution?: string; resolvedBy?: string };

    if (!conflictId || !resolution) {
      throw new AppError("conflictId and resolution are required", 400);
    }

    const conflict = await prisma.conflict.findUnique({ where: { id: Number(conflictId) } });
    if (!conflict) throw new AppError("Conflict not found", 404);

    const updated = await prisma.conflict.update({
      where: { id: Number(conflictId) },
      data: { resolution, status: "resolved" },
    });

    const remaining = await prisma.conflict.count({ where: { sessionId: conflict.sessionId, status: "unresolved" } });

    return res.json({ success: true, conflict: updated, allResolved: remaining === 0, remaining });
  } catch (error) {
    return next(error);
  }
};

const resolveConsolidation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { consolidationId, chosenOption } = req.body as { consolidationId?: number; chosenOption?: string };
    if (!consolidationId || !chosenOption) {
      throw new AppError("consolidationId and chosenOption are required", 400);
    }

    const scenario = await prisma.crossBranchScenario.findUnique({ where: { id: Number(consolidationId) } });
    if (!scenario) throw new AppError("Consolidation scenario not found", 404);

    const updated = await prisma.crossBranchScenario.update({
      where: { id: Number(consolidationId) },
      data: { chosenOption, status: "resolved", autoResolved: false },
    });

    // Auto-resolve related conflicts based on chosenOption
    const involved = Array.isArray(scenario.involvedBranches) ? scenario.involvedBranches : [];

    // Basic heuristics: if chosenOption contains 'remove' or 'use_removal' -> remove related conflicts
    const whereClause: any = { sessionId: scenario.sessionId, status: "unresolved" };
    if (scenario.fieldName && scenario.fieldName !== "") {
      whereClause.fieldName = scenario.fieldName;
    } else if (scenario.affectedEndpoint) {
      whereClause.endpoint = scenario.affectedEndpoint;
    }

    const related = await prisma.conflict.findMany({ where: whereClause });

    const affected: any[] = [];
    for (const r of related) {
      // decide resolution text
      let resolution = `consolidation:${chosenOption}`;
      await prisma.conflict.update({ where: { id: r.id }, data: { resolution, status: "resolved" } });
      affected.push(r.id);
    }

    return res.json({ consolidation: updated, affectedConflicts: affected });
  } catch (error) {
    return next(error);
  }
};

const bulkResolve = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId, resolution, severity } = req.body as { sessionId?: number; resolution?: string; severity?: string };
    if (!sessionId || !resolution) throw new AppError("sessionId and resolution are required", 400);

    const where: any = { sessionId: Number(sessionId), status: "unresolved" };
    if (severity) {
      where.impactLevel = severity.toUpperCase();
    }

    const result = await prisma.conflict.updateMany({ where, data: { resolution, status: "resolved" } });

    return res.json({ resolvedCount: result.count });
  } catch (error) {
    return next(error);
  }
};

const getSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (Number.isNaN(sessionId)) throw new AppError("Invalid sessionId", 400);

    const session = await prisma.conflictSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AppError("Session not found", 404);

    const conflicts = await prisma.conflict.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" } });

    const grouped: Record<string, any[]> = { Critical: [], High: [], Medium: [], Low: [], Easy: [] };
    let resolved = 0;
    for (const c of conflicts) {
      const level = c.impactLevel || "Easy";
      if (!grouped[level]) grouped[level] = [];
      grouped[level].push(c);
      if (c.status === "resolved") resolved++;
    }

    const consolidationConflicts = await prisma.crossBranchScenario.findMany({ where: { sessionId } });

    const total = conflicts.length;
    const unresolved = total - resolved;
    const criticalUnresolved = (grouped["Critical"] || []).filter((c: any) => c.status !== "resolved").length;

    return res.json({
      session,
      conflictsGrouped: grouped,
      consolidationConflicts,
      stats: { total, resolved, unresolved, criticalUnresolved },
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  startDetection,
  resolveConflict,
  resolveConsolidation,
  bulkResolve,
  getSession,
};