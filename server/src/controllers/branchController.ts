import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";

import deepExtractor, { Field } from "../extractor/deepExtractor";
import prisma from "../lib/prisma";
import extractorService from "../services/extractorService";
import githubService from "../services/githubService";
import AppError from "../utils/AppError";

const getByRepo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repoId = Number(req.query.repoId);

    if (Number.isNaN(repoId)) {
      throw new AppError("repoId query parameter is required", 400);
    }

    const branches = await prisma.branch.findMany({
      where: { repoId },
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: { endpoints: true },
        },
      },
    });

    return res.json(
      branches.map((branch) => ({
        ...branch,
        endpointCount: branch._count.endpoints,
      }))
    );
  } catch (error) {
    return next(error);
  }
};

const getOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branchId = Number(req.params.id);

    if (Number.isNaN(branchId)) {
      throw new AppError("Invalid branch id", 400);
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        endpoints: true,
      },
    });

    if (!branch) {
      throw new AppError("Branch not found", 404);
    }

    return res.json(branch);
  } catch (error) {
    return next(error);
  }
};

const scanBranch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branchId = Number(req.params.id);

    if (Number.isNaN(branchId)) {
      throw new AppError("Invalid branch id", 400);
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, repoId: true, name: true },
    });

    if (!branch) {
      throw new AppError("Branch not found", 404);
    }

    const scanResult = await extractorService.scanBranch(branchId);

    const updatedBranch = await prisma.branch.update({
      where: { id: branchId },
      data: {
        totalApis: scanResult.totalApis,
        lastScanned: scanResult.lastScanned,
        scanStatus: "ready",
      },
    });

    const repoAggregation = await prisma.branch.aggregate({
      where: { repoId: branch.repoId },
      _sum: { totalApis: true },
    });

    await prisma.repository.update({
      where: { id: branch.repoId },
      data: {
        totalApis: repoAggregation._sum.totalApis ?? 0,
        lastScanned: scanResult.lastScanned,
      },
    });

    return res.json({
      message: "Branch scanned successfully",
      branch: updatedBranch,
    });
  } catch (error) {
    return next(error);
  }
};

const scanStream = async (req: Request, res: Response, next: NextFunction) => {
  const branchId = Number(req.params.id);

  if (Number.isNaN(branchId)) {
    return next(new AppError("Invalid branch id", 400));
  }

  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        repo: {
          select: {
            id: true,
            githubUrl: true,
            fullName: true,
          },
        },
      },
    });

    if (!branch) {
      throw new AppError("Branch not found", 404);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (event: string, data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
    };

    let isClosed = false;
    req.on("close", () => {
      isClosed = true;
    });

    const safeDelay = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const run = async () => {
      await prisma.branch.update({
        where: { id: branchId },
        data: { scanStatus: "scanning" },
      });

      if (isClosed) {
        return;
      }

      sendEvent("phase", { phase: 1, status: "running" });
      sendEvent("saving", { message: "Fetching repository file tree..." });

      const { owner, repo } = githubService.parseGithubUrl(branch.repo.githubUrl);
      const files = await githubService.getRepoFiles(owner, repo, branch.name);

      sendEvent("saving", { message: `${files.length} files found` });
      sendEvent("saving", { message: "Scanning for API-related files..." });

      const detectedApiFiles: string[] = [];
      const apiPatterns = [
        /route/i,
        /controller/i,
        /router/i,
        /endpoint/i,
        /api/i,
      ];

      for (const fileName of files.slice(0, 60)) {
        if (isClosed) {
          return;
        }

        const isApiFile = apiPatterns.some((pattern) => pattern.test(fileName));
        if (isApiFile) {
          detectedApiFiles.push(fileName);
          sendEvent("file_found", {
            fileName,
            isApiFile: true,
            reason: "Found API naming pattern",
          });
        } else {
          sendEvent("file_skip", {
            fileName,
            reason: "No API patterns detected",
          });
        }

        await safeDelay(100);
      }

      if (isClosed) {
        return;
      }

      sendEvent("phase", { phase: 1, status: "complete" });
      sendEvent("phase", { phase: 2, status: "running" });

      sendEvent("saving", { message: "Loading API files for deep backtracking extraction..." });

      const allProjectFiles = new Map<string, string>();
      const filesToLoad = files.slice(0, 160);
      for (const projectFile of filesToLoad) {
        if (isClosed) {
          return;
        }

        try {
          const content = await githubService.getFileContent(owner, repo, branch.name, projectFile);
          allProjectFiles.set(projectFile, content);
        } catch {
          allProjectFiles.set(projectFile, "");
        }

        await safeDelay(24);
      }

      let discovered = 0;
      let totalExtractedFields = 0;
      const extractedEndpointRows: Array<{
        method: string;
        path: string;
        lineStart: number;
        lineEnd: number;
        requiredFields: Field[];
        optionalFields: Field[];
        responseFields: Field[];
        rawDefinition: string;
        fileName: string;
      }> = [];
      const totalEstimated = Math.max(detectedApiFiles.length, 1);

      const formatFieldSource = (source: Field["source"]) => {
        if (source === "body") {
          return "body";
        }
        if (source === "params") {
          return "params";
        }
        if (source === "query") {
          return "query";
        }
        if (source === "headers") {
          return "headers";
        }
        if (source === "validation") {
          return "validation";
        }
        return "response";
      };

      const toJsonFields = (fields: Field[]): Prisma.InputJsonValue =>
        fields.map((field) => ({
          name: field.name,
          type: field.type ?? "unknown",
          required: field.required,
          lineNumber: field.lineNumber ?? null,
          source: field.source,
        })) as Prisma.InputJsonValue;

      for (const fileName of detectedApiFiles) {
        if (isClosed) {
          return;
        }

        const fileContent = allProjectFiles.get(fileName);
        if (!fileContent) {
          sendEvent("file_skip", {
            fileName,
            reason: "Unable to load file content",
          });
          continue;
        }

        sendEvent("saving", { message: `Deep extracting routes from ${fileName}` });

        const extracted = deepExtractor.extractFromFile(fileName, fileContent, allProjectFiles, {
          onBacktrackStart: (payload) => sendEvent("backtrack_start", payload),
          onBacktrackFound: (payload) => sendEvent("backtrack_found", payload),
          onFieldsExtracted: (payload) => sendEvent("fields_extracted", payload),
          onBacktrackFailed: (payload) => sendEvent("backtrack_failed", payload),
        });

        for (const route of extracted.routes) {
          if (isClosed) {
            return;
          }

          discovered += 1;
          const primaryHandler = route.handlers[route.handlers.length - 1]?.name ?? "unknown";
          const totalRouteFields = route.requestFields.length + route.responseFields.length;
          totalExtractedFields += totalRouteFields;

          extractedEndpointRows.push({
            method: route.method,
            path: route.path,
            lineStart: route.lineNumber,
            lineEnd: route.lineNumber,
            requiredFields: route.requestFields.filter((field) => field.required),
            optionalFields: route.requestFields.filter((field) => !field.required),
            responseFields: route.responseFields,
            rawDefinition: `${route.method} ${route.path} -> ${primaryHandler}`,
            fileName,
          });

          sendEvent("endpoint_found", {
            fileName,
            method: route.method,
            path: route.path,
            fieldsCount: totalRouteFields,
            lineStart: route.lineNumber,
            handler: primaryHandler,
            handlerType: route.handlerType,
            backtrackDepth: route.backtrackDepth,
            confidence: route.confidence,
          });

          if (route.handlerType === "inline") {
            sendEvent("fields_extracted", {
              handler: primaryHandler,
              requestFields: route.requestFields,
              responseFields: route.responseFields,
              extractedFrom: "inline function body",
            });
          }

          for (const field of [...route.requestFields, ...route.responseFields]) {
            sendEvent("field_extracted", {
              fieldName: field.name,
              fieldType: field.type ?? "unknown",
              required: field.required,
              source: formatFieldSource(field.source),
            });
          }

          sendEvent("progress", {
            current: Math.min(discovered, totalEstimated),
            total: totalEstimated,
            percent: Math.min(95, Math.round((Math.min(discovered, totalEstimated) / totalEstimated) * 100)),
          });

          await safeDelay(110);
        }
      }

      if (isClosed) {
        return;
      }

      sendEvent("phase", { phase: 2, status: "complete" });
      sendEvent("phase", { phase: 3, status: "running" });
      sendEvent("saving", { message: "Saving extracted endpoints to PostgreSQL..." });

      const scanResult = await prisma.$transaction(async (tx) => {
        await tx.apiEndpoint.deleteMany({
          where: { branchId },
        });

        if (extractedEndpointRows.length > 0) {
          await tx.apiEndpoint.createMany({
            data: extractedEndpointRows.map((endpoint) => ({
              branchId,
              method: endpoint.method,
              path: endpoint.path,
              lineStart: endpoint.lineStart,
              lineEnd: endpoint.lineEnd,
              requiredFields: toJsonFields(endpoint.requiredFields),
              optionalFields: toJsonFields(endpoint.optionalFields),
              responseFields: toJsonFields(endpoint.responseFields),
              rawDefinition: endpoint.rawDefinition,
              fileName: endpoint.fileName,
            })),
          });
        }

        const totalApis = await tx.apiEndpoint.count({
          where: { branchId },
        });

        return {
          totalApis,
          lastScanned: new Date(),
        };
      });

      const updatedBranch = await prisma.branch.update({
        where: { id: branchId },
        data: {
          totalApis: scanResult.totalApis,
          lastScanned: scanResult.lastScanned,
          scanStatus: "ready",
        },
      });

      const repoAggregation = await prisma.branch.aggregate({
        where: { repoId: branch.repoId },
        _sum: { totalApis: true },
      });

      await prisma.repository.update({
        where: { id: branch.repoId },
        data: {
          totalApis: repoAggregation._sum.totalApis ?? 0,
          lastScanned: scanResult.lastScanned,
        },
      });

      const apiFileCount = detectedApiFiles.length;
      const fields = Math.max(scanResult.totalApis * 3, totalExtractedFields);

      sendEvent("progress", {
        current: scanResult.totalApis,
        total: Math.max(scanResult.totalApis, 1),
        percent: 100,
      });

      sendEvent("phase", { phase: 3, status: "complete" });
      sendEvent("complete", {
        totalFiles: files.length,
        apiFiles: apiFileCount,
        endpoints: updatedBranch.totalApis,
        fields,
      });

      res.end();
    };

    run().catch(async (error) => {
      if (!isClosed) {
        sendEvent("error", {
          message: error instanceof Error ? error.message : "Scan failed",
        });

        await prisma.branch.update({
          where: { id: branchId },
          data: { scanStatus: "failed" },
        });

        res.end();
      }
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  getByRepo,
  getOne,
  scanBranch,
  scanStream,
};