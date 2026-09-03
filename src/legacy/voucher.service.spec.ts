/**
 * Prueba de regresión del fallo de doble canje del código original.
 * Simula 20 solicitudes simultáneas y exige que exactamente una pueda cambiar el voucher
 * de disponible a canjeado y acreditar el saldo una sola vez.
 */
import { ConflictException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { CpuVerifierService } from './cpu-verifier.service';
import { UserDocument } from './schemas/user.schema';
import { VoucherDocument } from './schemas/voucher.schema';
import { VoucherService } from './voucher.service';

type ExecQuery<T> = { exec: () => Promise<T> };

describe('VoucherService regression - concurrent double redemption', () => {
  it('* Simula 20 solicitudes simultáneas y exige que exactamente una pueda cambiar el voucher *', async () => {
    
    const voucherId = new Types.ObjectId();
    let redeemed = false;
    let balanceCents = 0;

    const voucherModel = {
      findOneAndUpdate: (): ExecQuery<VoucherDocument | null> => {
        if (redeemed) return { exec: async () => null };
        redeemed = true; // Simula: el cambio ocurre antes de que otra llamada pueda observar el estado.
        const voucher = {
          _id: voucherId,
          amountCents: 2500,
          isRedeemed: true,
          redeemedBy: 'u1',
          redeemedAt: new Date(),
        } as unknown as VoucherDocument;
        return { exec: async () => voucher };
      },
    } as unknown as Model<VoucherDocument>;

    const userModel = {
      findOneAndUpdate: (): ExecQuery<UserDocument> => {
        balanceCents += 2500;
        const user = { userId: 'u1', balanceCents } as unknown as UserDocument;
        return { exec: async () => user };
      },
    } as unknown as Model<UserDocument>;

    const cpuVerifier = { verify: async (): Promise<void> => undefined } as CpuVerifierService;
    const service = new VoucherService(voucherModel, userModel, cpuVerifier);

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () => service.redeemVoucher('u1', voucherId.toString())),
    );

    const successes = settled.filter((r) => r.status === 'fulfilled');
    const failures = settled.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);
    expect(balanceCents).toBe(2500);
    failures.forEach((result) => {
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    });
  });
});
