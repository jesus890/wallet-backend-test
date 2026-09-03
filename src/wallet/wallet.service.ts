/**
 * Núcleo de negocio de la Parte 2.
 * Implementa idempotencia persistente, débito atómico condicionado por saldo suficiente
 * y paginación keyset sin skip(). Está diseñado para funcionar con varias instancias de NestJS.
 */
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { User, UserDocument } from '../legacy/schemas/user.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { IdempotencyDocument, IdempotencyRecord } from './schemas/idempotency.schema';
import { WalletTransaction, WalletTransactionDocument } from './schemas/transaction.schema';
import { CursorService } from './cursor.service';

export interface TransactionResponse {
  transactionId: string;
  userId: string;
  amount: number;
  concept: string;
  newBalance: number;
  createdAt: string;
}

export interface CreateOutcome {
  statusCode: 201;
  body: TransactionResponse;
}

export interface TransactionPage {
  data: TransactionResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

function isDuplicateKey(error: unknown): error is { code: number } {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 11000;
}

@Injectable()
export class WalletService {
  private readonly ttlMs: number;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(WalletTransaction.name) private readonly transactionModel: Model<WalletTransactionDocument>,
    @InjectModel(IdempotencyRecord.name) private readonly idempotencyModel: Model<IdempotencyDocument>,
    private readonly cursorService: CursorService,
    config: ConfigService,
  ) {
    const ttlSeconds = Number(config.get<string>('IDEMPOTENCY_TTL_SECONDS') ?? '600');
    this.ttlMs = ttlSeconds * 1000;
  }

  async createTransaction(key: string, dto: CreateTransactionDto): Promise<CreateOutcome> {
    const payloadHash = this.hashPayload(dto);
    const now = new Date();

    // El TTL de MongoDB limpia físicamente los registros expirados en segundo plano.
    // Esta eliminación adicional hace efectiva la expiración lógica inmediatamente, ya que
    // el monitor TTL no garantiza borrar el documento exactamente al cumplirse los 10 minutos.
    await this.idempotencyModel.deleteOne({ key, expiresAt: { $lte: now } }).exec();

    try {
      await this.idempotencyModel.create({
        key,
        payloadHash,
        state: 'PROCESSING',
        expiresAt: new Date(now.getTime() + this.ttlMs),
        responseStatus: null,
        responseBody: null,
      });
    } catch (error: unknown) {
      if (!isDuplicateKey(error)) throw error;
      return this.resolveExistingKey(key, payloadHash);
    }

    const amountCents = this.toCents(dto.amount);

    // RUTA CRÍTICA: una sola operación atómica de MongoDB valida.
    const user = await this.userModel.findOneAndUpdate(
      { userId: dto.userId, balanceCents: { $gte: amountCents } },
      { $inc: { balanceCents: -amountCents } },
      { new: true },
    ).exec();

    if (!user) {
      const exists = await this.userModel.exists({ userId: dto.userId });
      const message = exists ? 'Saldo insuficiente' : 'Usuario no encontrado';
      const status = exists ? 422 : 404;
      await this.completeError(key, status, message);
      if (exists) throw new UnprocessableEntityException(message);
      throw new NotFoundException(message);
    }

    try {
      const transaction = await this.transactionModel.create({
        userId: dto.userId,
        amountCents,
        concept: dto.concept,
        balanceAfterCents: user.balanceCents,
      });

      const body: TransactionResponse = {
        transactionId: transaction._id.toString(),
        userId: dto.userId,
        amount: this.fromCents(amountCents),
        concept: dto.concept,
        newBalance: this.fromCents(user.balanceCents),
        createdAt: transaction.createdAt.toISOString(),
      };

      await this.idempotencyModel.updateOne(
        { key, state: 'PROCESSING' },
        { $set: { state: 'COMPLETED', responseStatus: 201, responseBody: body } },
      ).exec();

      return { statusCode: 201, body };
    } catch (error: unknown) {
      // Compensación best-effort. Una transacción Mongo sería necesaria para
      // all-or-nothing estricto entre user + transaction + idempotency record.
      await this.userModel.updateOne(
        { userId: dto.userId },
        { $inc: { balanceCents: amountCents } },
      ).exec();
      await this.idempotencyModel.deleteOne({ key, state: 'PROCESSING' }).exec();
      throw new InternalServerErrorException('No fue posible persistir la transacción', { cause: error });
    }
  }

  async listTransactions(userId: string, limit: number, cursor?: string): Promise<TransactionPage> {
    const filter: FilterQuery<WalletTransactionDocument> = { userId };

    if (cursor) {
      const decoded = this.cursorService.decode(cursor);
      const createdAt = new Date(decoded.createdAt);
      const id = new Types.ObjectId(decoded.id);
      filter.$or = [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: id } },
      ];
    }

    const docs = await this.transactionModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const data = page.map((tx: { _id: Types.ObjectId; userId: string; amountCents: number; concept: string; balanceAfterCents: number; createdAt: Date }) => ({
      transactionId: tx._id.toString(),
      userId: tx.userId,
      amount: this.fromCents(tx.amountCents),
      concept: tx.concept,
      newBalance: this.fromCents(tx.balanceAfterCents),
      createdAt: tx.createdAt.toISOString(),
    }));

    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? this.cursorService.encode({ createdAt: last.createdAt.toISOString(), id: last._id.toString() })
      : null;

    return { data, nextCursor, hasMore };
  }

  private async resolveExistingKey(key: string, payloadHash: string): Promise<CreateOutcome> {
    const existing = await this.idempotencyModel.findOne({ key }).lean().exec();
    if (!existing) {
      // Existe una carrera poco frecuente: el TTL puede eliminar el registro entre el intento
      // de insertarlo y esta lectura. No se debita nada; el cliente puede reintentar con seguridad.
      throw new ConflictException('La clave expiró durante el procesamiento; reintenta la solicitud');
    }
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException('X-Idempotency-Key reutilizada con un payload diferente');
    }
    if (existing.state === 'PROCESSING') {
      throw new ConflictException('Ya existe una solicitud en procesamiento para esta X-Idempotency-Key');
    }
    if (existing.responseStatus === 201 && existing.responseBody) {
      return { statusCode: 201, body: existing.responseBody as unknown as TransactionResponse };
    }
    if (existing.responseStatus === 422) {
      throw new UnprocessableEntityException('Saldo insuficiente');
    }
    if (existing.responseStatus === 404) {
      throw new NotFoundException('Usuario no encontrado');
    }
    throw new ConflictException('La clave de idempotencia tiene un estado no reproducible');
  }

  private async completeError(key: string, status: number, message: string): Promise<void> {
    await this.idempotencyModel.updateOne(
      { key, state: 'PROCESSING' },
      { $set: { state: 'COMPLETED', responseStatus: status, responseBody: { message } } },
    ).exec();
  }

  private hashPayload(dto: CreateTransactionDto): string {
    // Orden canónico explícito para que el hash no dependa del orden de propiedades JSON.
    return createHash('sha256')
      .update(JSON.stringify({ userId: dto.userId, amount: dto.amount, concept: dto.concept }))
      .digest('hex');
  }

  private toCents(amount: number): number {
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new UnprocessableEntityException('Monto fuera de rango');
    }
    return cents;
  }

  private fromCents(cents: number): number {
    return cents / 100;
  }
}
