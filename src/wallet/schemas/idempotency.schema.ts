/**
 * Registro persistente de idempotencia.
 */

import {
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';

import { HydratedDocument } from 'mongoose';

export type IdempotencyDocument =
  HydratedDocument<IdempotencyRecord>;

export type IdempotencyState =
  | 'PROCESSING'
  | 'COMPLETED';

@Schema({
  timestamps: true,
  collection: 'idempotency_keys',
})
export class IdempotencyRecord {
  @Prop({
    type: String,
    required: true,
    unique: true,
  })
  key!: string;

  @Prop({
    type: String,
    required: true,
  })
  payloadHash!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['PROCESSING', 'COMPLETED'],
  })
  state!: IdempotencyState;

  @Prop({
    type: Date,
    required: true,
  })
  expiresAt!: Date;

  @Prop({
    type: Number,
    default: null,
  })
  responseStatus!: number | null;

  @Prop({
    type: Object,
    default: null,
  })
  responseBody!:
    | Record<string, unknown>
    | null;
}

export const IdempotencySchema =
  SchemaFactory.createForClass(
    IdempotencyRecord,
  );

IdempotencySchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
  },
);