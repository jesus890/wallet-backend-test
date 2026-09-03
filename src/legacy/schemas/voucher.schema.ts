/**
 * Modelo persistente de un voucher.
 * isRedeemed forma parte del filtro que impide que dos
 * solicitudes concurrentes canjeen el mismo voucher.
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VoucherDocument = HydratedDocument<Voucher>;

@Schema({
  timestamps: true,
  collection: 'vouchers',
})
export class Voucher {
  @Prop({
    type: String,
    required: true,
    unique: true,
    index: true,
  })
  code!: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
  })
  amountCents!: number;

  @Prop({
    type: Boolean,
    default: false,
    index: true,
  })
  isRedeemed!: boolean;

  @Prop({
    type: String,
    default: null,
  })
  redeemedBy!: string | null;

  @Prop({
    type: Date,
    default: null,
  })
  redeemedAt!: Date | null;
}

export const VoucherSchema =
  SchemaFactory.createForClass(Voucher);