import { Router } from "express";
import conflictController from "../controllers/conflictController";
import prisma from "../lib/prisma";
import detectConflicts from "../conflict/conflictDetector";

// Helper to map DB ApiEndpoint rows into detector-friendly shape
const mapEndpointRow = (row: any) => ({
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
});

const router = Router();

router.post("/detect", conflictController.startDetection);
router.get("/session/:sessionId", conflictController.getSession);
router.patch("/:conflictId/resolve", conflictController.resolveConflict);
router.patch("/consolidation/:id/resolve", conflictController.resolveConsolidation);
router.post("/session/:sessionId/bulk-resolve", conflictController.bulkResolve);

router.get("/session/:sessionId/progress", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (Number.isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

    // Reuse controller's getSession to fetch stats
    const result = await conflictController.getSession(req, res, next);
    // getSession already sends response, so nothing more to do here
    return result;
  } catch (err) {
    return next(err);
  }
});

// Debug: list endpoints extracted for a branch
router.get("/debug/endpoints/:branchId", async (req, res, next) => {
  try {
    const branchId = Number(req.params.branchId);
    if (Number.isNaN(branchId)) return res.status(400).json({ error: "Invalid branchId" });

    const rows = await prisma.apiEndpoint.findMany({ where: { branchId } });
    const endpoints = rows.map((r) => ({
      path: r.path,
      method: r.method,
      requiredFields: Array.isArray(r.requiredFields) ? r.requiredFields : [],
      optionalFields: Array.isArray(r.optionalFields) ? r.optionalFields : [],
      responseFields: Array.isArray(r.responseFields) ? r.responseFields : [],
      lineStart: r.lineStart ?? 0,
      lineEnd: r.lineEnd ?? 0,
      fileName: r.fileName ?? "",
    }));

    return res.json({ branchId, totalEndpoints: endpoints.length, endpoints });
  } catch (err) {
    return next(err);
  }
});

// Debug: run detector between mainBranchId and branchId and return raw conflicts
router.get("/debug/compare/:mainBranchId/:branchId", async (req, res, next) => {
  try {
    const mainBranchId = Number(req.params.mainBranchId);
    const branchId = Number(req.params.branchId);
    if (Number.isNaN(mainBranchId) || Number.isNaN(branchId)) return res.status(400).json({ error: "Invalid branch ids" });

    const mainRows = await prisma.apiEndpoint.findMany({ where: { branchId: mainBranchId } });
    const branchRows = await prisma.apiEndpoint.findMany({ where: { branchId } });

    const mainEndpoints = mainRows.map(mapEndpointRow);
    const branchEndpoints = branchRows.map(mapEndpointRow);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    const branchName = branch?.name ?? `branch-${branchId}`;

    const conflicts = detectConflicts(mainEndpoints as any, branchEndpoints as any, branchName);

    return res.json({ mainBranchId, branchId, conflicts });
  } catch (err) {
    return next(err);
  }
});

export default router;
 