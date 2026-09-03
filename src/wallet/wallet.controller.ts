/**
 * Controlador HTTP del módulo Wallet.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';

import { Response } from 'express';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { WalletService } from './wallet.service';

@Controller('wallet/transactions')
export class WalletController {
  constructor(
    private readonly walletService:
      WalletService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Headers('x-idempotency-key')
    rawIdempotencyKey: string | undefined,

    @Body()
    dto: CreateTransactionDto,

    @Res({ passthrough: true })
    response: Response,
  ): Promise<object> {
    /*
     * @Headers no acepta un pipe como segundo
     * argumento. Por eso el pipe se ejecuta aquí.
     */
    const idempotencyKey =
      await new ParseUUIDPipe({
        version: '4',
      }).transform(
        rawIdempotencyKey ?? '',
        {
          type: 'custom',
        },
      );

    const result =
      await this.walletService
        .createTransaction(
          idempotencyKey,
          dto,
        );

    response.status(result.statusCode);

    return result.body;
  }

  @Get(':userId')
  async list(
    @Param('userId')
    userId: string,

    @Query()
    query: ListTransactionsDto,
  ): Promise<object> {
    return this.walletService
      .listTransactions(
        userId,
        query.limit,
        query.cursor,
      );
  }
}