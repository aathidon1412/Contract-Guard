import { NextFunction, Request, Response } from "express";

import prisma from "../lib/prisma";
import AppError from "../utils/AppError";

const getBySession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.query.sessionId);

    if (Number.isNaN(sessionId)) {
      throw new AppError("sessionId query parameter is required", 400);
    }

    const conflicts = await prisma.conflict.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(conflicts);
  } catch (error) {
    return next(error);
  }
};

const resolveOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conflictId = Number(req.params.id);
    const { resolution } = req.body as { resolution?: string };

    if (Number.isNaN(conflictId)) {
      throw new AppError("Invalid conflict id", 400);
    }

    if (!resolution) {
      throw new AppError("resolution is required", 400);
    }

    const conflict = await prisma.conflict.findUnique({
      where: { id: conflictId },
      select: { id: true },
    });

    if (!conflict) {
      throw new AppError("Conflict not found", 404);
    }

    const updatedConflict = await prisma.conflict.update({
      where: { id: conflictId },
      data: {
        resolution,
        status: "resolved",
      },
    });

    return res.json(updatedConflict);
  } catch (error) {
    return next(error);
  }
};

const resolveAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId, resolution } = req.body as {
      sessionId?: number;
      resolution?: string;
    };

    if (!sessionId || !resolution) {
      throw new AppError("sessionId and resolution are required", 400);
    }

    const result = await prisma.conflict.updateMany({
      where: {
        sessionId: Number(sessionId),
        status: "unresolved",
      },
      data: {
        resolution,
        status: "resolved",
      },
    });

    return res.json({
      message: "Conflicts resolved",
      updatedCount: result.count,
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  getBySession,
  resolveOne,
  resolveAll,
};