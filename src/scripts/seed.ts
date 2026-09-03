/**
 * Seed reproducible.
 *
 * Crea:
 * - seed-user con $500.
 * - load-user con $100.
 * - 200 transacciones históricas.
 * - 5 transacciones con el mismo createdAt.
 */

import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

interface SeedUser {
  userId: string;
  balanceCents: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedTransaction {
  _id: Types.ObjectId;
  userId: string;
  amountCents: number;
  concept: string;
  balanceAfterCents: number;
  createdAt: Date;
  updatedAt: Date;
}

async function seed(): Promise<void> {
  const uri =
    process.env.MONGODB_URI ??
    'mongodb://localhost:27017/wallet';

  await mongoose.connect(uri);

  try {
    const database = mongoose.connection.db;

    if (!database) {
      throw new Error(
        'No existe una conexión activa con MongoDB',
      );
    }

    const users =
      database.collection<SeedUser>('users');

    const transactions =
      database.collection<SeedTransaction>(
        'transactions',
      );

    /*
     * El seed puede ejecutarse varias veces.
     */
    await users.deleteMany({
      userId: {
        $in: ['seed-user', 'load-user'],
      },
    });

    await transactions.deleteMany({
      userId: {
        $in: ['seed-user', 'load-user'],
      },
    });

    const now = new Date();

    await users.insertMany([
      {
        userId: 'seed-user',
        balanceCents: 50_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        userId: 'load-user',
        balanceCents: 10_000,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const sameTimestamp =
      new Date('2026-01-15T12:00:00.000Z');

    const baseTimestamp =
      new Date(
        '2026-01-20T12:00:00.000Z',
      ).getTime();

    const historicalTransactions:
      SeedTransaction[] = [];

    for (let index = 0; index < 200; index += 1) {
      /*
       * Las primeras cinco comparten exactamente
       * el mismo milisegundo.
       */
      const createdAt =
        index < 5
          ? sameTimestamp
          : new Date(
              baseTimestamp -
                index * 60_000,
            );

      historicalTransactions.push({
        _id: new Types.ObjectId(),
        userId: 'seed-user',
        amountCents: 100 + (index % 10),
        concept:
          `Historical transaction ${index + 1}`,
        balanceAfterCents:
          Math.max(
            0,
            50_000 - index * 100,
          ),
        createdAt,
        updatedAt: createdAt,
      });
    }

    await transactions.insertMany(
      historicalTransactions,
    );

    /*
     * Índice para paginación keyset.
     */
    await transactions.createIndex({
      userId: 1,
      createdAt: -1,
      _id: -1,
    });

    /*
     * Índice TTL de idempotencia.
     */
    await database
      .collection('idempotency_keys')
      .createIndex(
        {
          expiresAt: 1,
        },
        {
          expireAfterSeconds: 0,
        },
      );

    console.log(
      'Seed OK: seed-user, load-user y 200 transacciones creadas.',
    );
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch(async (error: unknown) => {
  console.error('El seed falló:', error);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});