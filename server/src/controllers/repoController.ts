import { NextFunction, Request, Response } from "express";

import prisma from "../lib/prisma";
import extractorService from "../services/extractorService";
import githubService from "../services/githubService";
import AppError from "../utils/AppError";

const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const repos = await prisma.repository.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        branches: {
          include: {
            _count: {
              select: { endpoints: true },
            },
          },
        },
      },
    });

    const payload = repos.map((repo) => {
      const totalApis = repo.branches.reduce(
        (sum, branch) => sum + (branch.totalApis || branch._count.endpoints),
        0
      );

      return {
        ...repo,
        totalApis,
        branchCount: repo.branches.length,
      };
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
};

const addRepo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { githubUrl } = req.body as { githubUrl?: string };

    if (!githubUrl) {
      throw new AppError("githubUrl is required", 400);
    }

    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(githubUrl.trim())) {
      throw new AppError("Invalid GitHub URL format", 400);
    }

    const repoInfo = await githubService.getRepoInfo(githubUrl);
    const existingRepo = await prisma.repository.findUnique({
      where: { fullName: repoInfo.fullName },
      include: { branches: true },
    });

    if (existingRepo) {
      return res.status(200).json(existingRepo);
    }

    const createdRepo = await prisma.repository.create({
      data: {
        name: repoInfo.name,
        fullName: repoInfo.fullName,
        githubUrl: repoInfo.githubUrl,
        description: repoInfo.description,
        language: repoInfo.language,
      },
    });

    const { owner, repo } = githubService.parseGithubUrl(createdRepo.githubUrl);
    const branches = await githubService.getBranches(owner, repo);

    if (branches.length > 0) {
      await prisma.branch.createMany({
        data: branches.map((branch) => ({
          repoId: createdRepo.id,
          name: branch.name,
          type: branch.type,
        })),
        skipDuplicates: true,
      });
    }

    const repoWithBranches = await prisma.repository.findUnique({
      where: { id: createdRepo.id },
      include: { branches: true },
    });

    return res.status(201).json(repoWithBranches);
  } catch (error) {
    return next(error);
  }
};

const getOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repoId = Number(req.params.id);
    if (Number.isNaN(repoId)) {
      throw new AppError("Invalid repository id", 400);
    }

    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      include: {
        branches: {
          include: {
            _count: {
              select: { endpoints: true },
            },
          },
        },
      },
    });

    if (!repo) {
      throw new AppError("Repository not found", 404);
    }

    const branches = repo.branches.map((branch) => ({
      ...branch,
      endpointCount: branch._count.endpoints,
    }));

    const totalApis = branches.reduce(
      (sum, branch) => sum + (branch.totalApis || branch.endpointCount),
      0
    );

    return res.json({
      ...repo,
      branches,
      totalApis,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteRepo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repoId = Number(req.params.id);
    if (Number.isNaN(repoId)) {
      throw new AppError("Invalid repository id", 400);
    }

    const existingRepo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { id: true, name: true },
    });

    if (!existingRepo) {
      return res.status(404).json({
        error: "Repository not found in ContractGuard",
      });
    }

    const deletedSummary = await prisma.$transaction(async (tx) => {
      const branches = await tx.branch.findMany({
        where: { repoId },
        select: { id: true },
      });
      const branchIds = branches.map((branch) => branch.id);

      const sessions = await tx.conflictSession.findMany({
        where: { repoId },
        select: { id: true },
      });
      const sessionIds = sessions.map((session) => session.id);

      const endpointCount = branchIds.length
        ? await tx.apiEndpoint.count({
            where: {
              branchId: { in: branchIds },
            },
          })
        : 0;

      const conflictCount = sessionIds.length
        ? await tx.conflict.count({
            where: {
              sessionId: { in: sessionIds },
            },
          })
        : 0;

      if (sessionIds.length > 0) {
        await tx.conflict.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });

        await tx.crossBranchScenario.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });

        await tx.conflictSession.deleteMany({
          where: { id: { in: sessionIds } },
        });
      }

      if (branchIds.length > 0) {
        await tx.apiEndpoint.deleteMany({
          where: { branchId: { in: branchIds } },
        });

        await tx.branch.deleteMany({
          where: { id: { in: branchIds } },
        });
      }

      await tx.repository.delete({
        where: { id: repoId },
      });

      return {
        repo: existingRepo.name,
        branches: branchIds.length,
        endpoints: endpointCount,
        sessions: sessionIds.length,
        conflicts: conflictCount,
      };
    });

    console.info(`🗑️ Removed [${existingRepo.name}] from ContractGuard tracking`);

    return res.json({
      success: true,
      message: "Repository removed from ContractGuard",
      deleted: deletedSummary,
      note: "Your GitHub repository is untouched",
    });
  } catch (error) {
    return next(error);
  }
};

const scanRepo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repoId = Number(req.params.id);
    if (Number.isNaN(repoId)) {
      throw new AppError("Invalid repository id", 400);
    }

    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      include: { branches: true },
    });

    if (!repo) {
      throw new AppError("Repository not found", 404);
    }

    const branchSummaries = await Promise.all(
      repo.branches.map(async (branch) => {
        const scanResult = await extractorService.scanBranch(branch.id);

        await prisma.branch.update({
          where: { id: branch.id },
          data: {
            totalApis: scanResult.totalApis,
            lastScanned: scanResult.lastScanned,
            scanStatus: "ready",
          },
        });

        return {
          branchId: branch.id,
          branchName: branch.name,
          totalApis: scanResult.totalApis,
        };
      })
    );

    const totalApis = branchSummaries.reduce((sum, branch) => sum + branch.totalApis, 0);

    await prisma.repository.update({
      where: { id: repoId },
      data: {
        totalApis,
        lastScanned: new Date(),
      },
    });

    return res.json({
      repoId,
      scannedBranches: branchSummaries.length,
      totalApis,
      branches: branchSummaries,
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  getAll,
  addRepo,
  getOne,
  deleteRepo,
  scanRepo,
};