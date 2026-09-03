/**
 * Filtro global de excepciones.
 * Normaliza errores de NestJS y errores inesperados al contrato solicitado por la prueba,
 * incluyendo path, timestamp y requestId para facilitar trazabilidad en producción.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestWithId } from '../middleware/request-id.middleware';

interface HttpErrorPayload {
  statusCode?: number;
  error?: string;
  message?: string | string[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & RequestWithId>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Unexpected server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        error = exception.name;
      } else {
        const typed = payload as HttpErrorPayload;
        message = typed.message ?? exception.message;
        error = typed.error ?? HttpStatus[status] ?? exception.name;
      }
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: request.requestId ?? 'unknown',
    });
  }
}
