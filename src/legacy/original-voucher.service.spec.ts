import { OriginalVoucherService } from './original-voucher.service';

interface VoucherState {
  _id: string;
  isRedeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: Date;
}

interface UserState {
  _id: string;
  balance: number;
}

describe('Código original: doble canje concurrente', () => {
    
  it('debería permitir exactamente un canje', async () => {
    const voucher: VoucherState = {
      _id: 'voucher-1',
      isRedeemed: false,
    };

    const user: UserState = {
      _id: 'user-1',
      balance: 0,
    };

    let voucherReads = 0;
    let releaseReads: (() => void) | undefined;

    /*
     * Esta barrera hace que las 20 llamadas lean el voucher
     * antes de que alguna pueda actualizarlo.
     */
    const allReadsStarted = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });

    const vouchersCollection = {
      findOne: jest.fn(async () => {
        voucherReads += 1;

        if (voucherReads === 20) {
          releaseReads?.();
        }

        await allReadsStarted;

        /*
         * Se devuelve una copia del estado observado.
         * Las 20 solicitudes procesan isRedeemed=false.
         */
        return { ...voucher };
      }),

      updateOne: jest.fn(
        async (
          _filter: Record<string, unknown>,
          update: {
            $set: {
              isRedeemed: boolean;
              redeemedBy: string;
              redeemedAt: Date;
            };
          },
        ) => {
          Object.assign(voucher, update.$set);
          return { modifiedCount: 1 };
        },
      ),
    };

    const usersCollection = {
      findOne: jest.fn(async () => ({ ...user })),

      updateOne: jest.fn(
        async (
          _filter: Record<string, unknown>,
          update: { $set: { balance: number } },
        ) => {
          user.balance = update.$set.balance;
          return { modifiedCount: 1 };
        },
      ),
    };

    const connection = {
      connectedAt: new Date(),

      collection: jest.fn((name: string) => {
        if (name === 'vouchers') {
          return vouchersCollection;
        }

        if (name === 'users') {
          return usersCollection;
        }

        throw new Error(`Colección desconocida: ${name}`);
      }),
    };

    /*
     * Cero iteraciones para que el test no ejecute
     * 100 millones de hashes.
     */
    const service = new OriginalVoucherService(connection, 0);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.redeemVoucher(
          'user-1',
          'voucher-1',
          100,
        ),
      ),
    );

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(19);
  });
});