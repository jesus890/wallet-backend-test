/**
 * Agrupa la refactorización del servicio legacy de vouchers y sus dependencias MongoDB.
 * Se mantiene separado del módulo Wallet para distinguir claramente la Parte 1 de la Parte 2.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CpuVerifierService } from './cpu-verifier.service';
import { User, UserSchema } from './schemas/user.schema';
import { Voucher, VoucherSchema } from './schemas/voucher.schema';
import { VoucherService } from './voucher.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Voucher.name, schema: VoucherSchema },
    { name: User.name, schema: UserSchema },
  ])],
  providers: [VoucherService, CpuVerifierService],
  exports: [VoucherService],
})
export class LegacyModule {}
