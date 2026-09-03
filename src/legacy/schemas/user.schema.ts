/**
 * Documento de usuario compartido por vouchers y wallet.
 * El saldo se persiste en centavos enteros para evitar errores de precisión de punto flotante
 * en operaciones monetarias.
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })

export class User {

  @Prop({ required: true, unique: true, index: true })
  userId!: string;

  @Prop({ required: true, default: 0, min: 0 })
  balanceCents!: number;
  
}

export const UserSchema = SchemaFactory.createForClass(User);
