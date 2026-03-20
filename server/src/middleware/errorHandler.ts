import { NextFunction, Request, Response } from "express";

import AppError from "../utils/AppError";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || "Internal Server Error";

  console.error(`[${new Date().toISOString()}]`, err);

  res.status(statusCode).json({
    error: message,
    status: statusCode,
  });
};