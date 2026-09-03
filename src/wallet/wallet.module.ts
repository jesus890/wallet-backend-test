/**
 * Módulo transaccional de Wallet.
 * Registra los modelos necesarios para débito, historial e idempotencia y expone
 * el controlador HTTP junto con los servicios que implementan las reglas de negocio.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../legacy/schemas/user.schema';
import { CursorService } from './cursor.service';
import { IdempotencyRecord, IdempotencySchema } from './schemas/idempotency.schema';
import { WalletTransaction, WalletTransactionSchema } from './schemas/transaction.schema';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: WalletTransaction.name, schema: WalletTransactionSchema },
    { name: IdempotencyRecord.name, schema: IdempotencySchema },
  ])],
  controllers: [WalletController],
  providers: [WalletService, CursorService],
})
export class WalletModule {}
