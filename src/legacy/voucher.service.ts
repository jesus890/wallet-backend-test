/**
 * Refactor del servicio legacy de canje.
 * El doble canje se evita mediante un findOneAndUpdate condicionado por isRedeemed=false;
 * los tokens usan entropía criptográfica y el trabajo pesado se delega fuera del Event Loop.
 */
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { CpuVerifierService } from './cpu-verifier.service';
import { User, UserDocument } from './schemas/user.schema';
import { Voucher, VoucherDocument } from './schemas/voucher.schema';

export interface RedemptionResult {
  success: true;
  token: string;
}

@Injectable()
export class VoucherService {
  constructor(
    @InjectModel(Voucher.name)
    private readonly voucherModel: Model<VoucherDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly cpuVerifier: CpuVerifierService,
  ) {}

  private generateRedemptionToken(): string {
    return `TKN-${randomBytes(32).toString('hex')}`;
  }

  async redeemVoucher(userId: string, voucherId: string): Promise<RedemptionResult> {
    if (!Types.ObjectId.isValid(voucherId)) {
      throw new ConflictException('Voucher inválido o ya canjeado');
    }

    // Si esta validación CPU es realmente obligatoria, se ejecuta fuera del Event Loop.
    await this.cpuVerifier.verify(userId);

    // Compare-and-set atómico: exactamente una llamada puede cambiar false -> true.
    const voucher = await this.voucherModel.findOneAndUpdate(
      { _id: new Types.ObjectId(voucherId), isRedeemed: false },
      {
        $set: {
          isRedeemed: true,
          redeemedBy: userId,
          redeemedAt: new Date(),
        },
      },
      { new: true },
    ).exec();

    if (!voucher) {
      throw new ConflictException('Voucher inválido o ya canjeado');
    }

    const user = await this.userModel.findOneAndUpdate(
      { userId },
      { $inc: { balanceCents: voucher.amountCents } },
      { new: true },
    ).exec();

    if (!user) {
      throw new InternalServerErrorException('No fue posible acreditar el saldo');
    }

    return { success: true, token: this.generateRedemptionToken() };
  }
}
