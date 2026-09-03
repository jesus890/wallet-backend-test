/**
 * Historial inmutable de débitos de wallet.
 * El índice compuesto (userId, createdAt, _id) soporta la paginación keyset eficiente y usa
 * _id como desempate cuando varias transacciones comparten exactamente el mismo milisegundo.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

@Schema({ timestamps: true, collection: 'transactions' })
export class WalletTransaction {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, min: 1 })
  amountCents!: number;

  @Prop({ required: true })
  concept!: string;

  @Prop({ required: true })
  balanceAfterCents!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);
// El orden del índice coincide con el filtro/orden de la consulta keyset. _id evita ambigüedad
// cuando varias operaciones tienen el mismo createdAt hasta el milisegundo.
WalletTransactionSchema.index({ userId: 1, createdAt: -1, _id: -1 });
