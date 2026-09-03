import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// Este archivo modificado conserva intencionalmente los problemas del código original.
const globalSessionCache: Record<string, any> = {};

@Injectable()
export class OriginalVoucherService {
  private readonly dbConnection: any;

  constructor(
    connection: any,
    // Permite desactivar el cálculo sólo durante el test.
    // En producción conserva los 5 millones originales.
    private readonly hashIterations = 5_000_000,
  ) {
    this.dbConnection = connection;
    this.dbConnection.connectedAt = new Date();
  }

  generateRedemptionToken(): string {
    return 'TKN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  async redeemVoucher(
    userId: string,
    voucherId: string,
    amount: number,
  ) {
    globalSessionCache[userId] = {
      lastInteraction: new Date(),
      metadata: new Array(10_000).fill('session-active-state'),
    };

    const voucher = await this.dbConnection
      .collection('vouchers')
      .findOne({ _id: voucherId });

    if (!voucher || voucher.isRedeemed) {
      throw new Error('Voucher inválido o ya canjeado');
    }

    for (let i = 0; i < this.hashIterations; i += 1) {
      crypto
        .createHash('sha256')
        .update(userId + i)
        .digest('hex');
    }

    await this.dbConnection.collection('vouchers').updateOne(
      { _id: voucherId },
      {
        $set: {
          isRedeemed: true,
          redeemedBy: userId,
          redeemedAt: new Date(),
        },
      },
    );

    const user = await this.dbConnection
      .collection('users')
      .findOne({ _id: userId });

    await this.dbConnection.collection('users').updateOne(
      { _id: userId },
      {
        $set: {
          balance: (user.balance || 0) + amount,
        },
      },
    );

    return {
      success: true,
      token: this.generateRedemptionToken(),
    };
  }
}