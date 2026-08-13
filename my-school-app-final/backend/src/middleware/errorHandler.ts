import type { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, message: 'Resource not found' });
}

export function errorHandler(error: Error | ApiError, _req: Request, res: Response, _next: NextFunction) {
  void _next;
  const status = error instanceof ApiError ? error.statusCode : 500;
  const payload = {
    success: false,
    message: error.message || 'Internal server error',
    ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
  };
  res.status(status).json(payload);
}
