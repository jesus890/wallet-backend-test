/**
 * Middleware de correlación de solicitudes.
 * Conserva X-Request-Id si el cliente lo envía; de lo contrario genera un UUID seguro.
 * El mismo identificador se devuelve en la respuesta y aparece en errores globales.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = incoming?.trim() || randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
