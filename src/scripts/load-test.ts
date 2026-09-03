/**
 * Prueba de concurrencia de la Parte 2.3.
 *
 * 1. Restablece load-user con $100.
 * 2. Envía 50 débitos simultáneos de $3.
 * 3. Cada petición usa una llave idempotente distinta.
 * 4. Consulta MongoDB para comprobar el saldo final.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

interface StoredUser {
  userId: string;
  balanceCents: number;
}

interface StoredTransaction {
  userId: string;
  concept: string;
}

interface LoadResult {
  status: number;
  body: unknown;
}

async function sendDebit(
  baseUrl: string,
  userId: string,
  amount: number,
  requestNumber: number,
): Promise<LoadResult> {
  const response = await fetch(
    `${baseUrl}/wallet/transactions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        userId,
        amount,
        concept: `load-test-${requestNumber}`,
      }),
    },
  );

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = {
      message: 'La API no devolvió JSON válido',
    };
  }

  return {
    status: response.status,
    body,
  };
}

async function main(): Promise<void> {
  const baseUrl =
    process.env.API_URL ??
    'http://localhost:3000/api/v1';

  const mongoUri =
    process.env.MONGODB_URI ??
    'mongodb://localhost:27017/wallet';

  const userId = 'load-user';

  const requestCount = 50;

  const amount = 3;

  const amountCents = 300;

  const initialBalanceCents = 10_000;

  await mongoose.connect(mongoUri);

  try {
    const database = mongoose.connection.db;

    if (!database) {
      throw new Error(
        'No existe una conexión activa con MongoDB',
      );
    }

    const users =
      database.collection<StoredUser>('users');

    const transactions =
      database.collection<StoredTransaction>(
        'transactions',
      );

    /*
     * Restablece el usuario antes de la prueba.
     */
    await users.updateOne(
      { userId },
      {
        $set: {
          userId,
          balanceCents: initialBalanceCents,
        },
      },
      {
        upsert: true,
      },
    );

    /*
     * Elimina resultados de pruebas anteriores.
     */
    await transactions.deleteMany({
      userId,
      concept: /^load-test-/,
    });

    /*
     * Las 50 promesas se crean antes de esperarlas.
     * Así las solicitudes quedan simultáneamente en vuelo.
     */
    const requests = Array.from(
      { length: requestCount },
      (_, index) =>
        sendDebit(
          baseUrl,
          userId,
          amount,
          index + 1,
        ),
    );

    const results = await Promise.all(requests);

    const successful = results.filter(
      (result) => result.status === 201,
    );

    const rejected = results.filter(
      (result) => result.status === 422,
    );

    const unexpected = results.filter(
      (result) =>
        result.status !== 201 &&
        result.status !== 422,
    );

    const successfulSumCents =
      successful.length * amountCents;

    /*
     * Se consulta MongoDB directamente.
     * No se usa el saldo de la última respuesta HTTP porque
     * las peticiones pueden terminar en distinto orden.
     */
    const finalUser = await users.findOne({
      userId,
    });

    if (!finalUser) {
      throw new Error(
        'No se encontró load-user después de la prueba',
      );
    }

    const finalBalanceCents =
      finalUser.balanceCents;

    const expectedFinalBalanceCents =
      initialBalanceCents -
      successfulSumCents;

    const equationHolds =
      expectedFinalBalanceCents ===
      finalBalanceCents;

    const balanceIsNonNegative =
      finalBalanceCents >= 0;

    const expectedSuccesses = Math.floor(
      initialBalanceCents / amountCents,
    );

    const expectedRejected =
      requestCount - expectedSuccesses;

    const countsAreCorrect =
      successful.length === expectedSuccesses &&
      rejected.length === expectedRejected;

    console.log('');
    console.log('RESULTADO DE LA PRUEBA DE CARGA');
    console.log('--------------------------------');

    console.log(
      `Saldo inicial: ${(initialBalanceCents / 100).toFixed(2)}`,
    );

    console.log(
      `Peticiones enviadas: ${requestCount}`,
    );

    console.log(
      `Peticiones exitosas (201): ${successful.length}`,
    );

    console.log(
      `Rechazadas por saldo (422): ${rejected.length}`,
    );

    console.log(
      `Respuestas inesperadas: ${unexpected.length}`,
    );

    console.log(
      `Suma debitada: ${(successfulSumCents / 100).toFixed(2)}`,
    );

    console.log(
      `Saldo final: ${(finalBalanceCents / 100).toFixed(2)}`,
    );

    console.log(
      `Saldo esperado: ${(expectedFinalBalanceCents / 100).toFixed(2)}`,
    );

    console.log(
      'saldo_inicial - suma(exitosas) == saldo_final:',
      equationHolds ? 'OK' : 'FAIL',
    );

    console.log(
      'Saldo final no negativo:',
      balanceIsNonNegative ? 'OK' : 'FAIL',
    );

    console.log(
      'Cantidad de éxitos y rechazos correcta:',
      countsAreCorrect ? 'OK' : 'FAIL',
    );

    if (unexpected.length > 0) {
      console.log('');
      console.log('Respuestas inesperadas:');

      for (const result of unexpected) {
        console.log(
          JSON.stringify(result, null, 2),
        );
      }
    }

    if (
      !equationHolds ||
      !balanceIsNonNegative ||
      !countsAreCorrect ||
      unexpected.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error: unknown) => {
  console.error(
    'La prueba de carga falló:',
    error,
  );

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});