import { Router } from "express";
import aiController from "../controllers/aiController";

const router = Router();

router.get("/status", aiController.getStatus);
router.post("/explain/conflict", aiController.explainConflict);
router.post("/explain/scenario", aiController.explainScenario);
router.post("/suggest", aiController.suggestResolution);
router.post("/migration-guide", aiController.generateMigrationGuide);

export default router;