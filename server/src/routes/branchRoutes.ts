import { Router } from "express";
import branchController from "../controllers/branchController";

const router = Router();

router.get("/", branchController.getByRepo);
router.get("/:id", branchController.getOne);
router.post("/:id/scan", branchController.scanBranch);
router.get("/:id/scan-stream", branchController.scanStream);

export default router;