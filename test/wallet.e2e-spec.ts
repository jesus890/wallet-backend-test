/**
 * Suite end-to-end de la API Wallet.
 * Cubre explícitamente los escenarios A-H de la consigna, validación estricta y los casos
 * especiales de cursor: timestamps repetidos, manipulación y límite máximo de página.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Model } from "mongoose";
import request = require("supertest");
import { AppModule } from "../src/app.module";
import { GlobalExceptionFilter } from "../src/common/filters/global-exception.filter";
import { User, UserDocument } from "../src/legacy/schemas/user.schema";
import {
  IdempotencyDocument,
  IdempotencyRecord,
} from "../src/wallet/schemas/idempotency.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
} from "../src/wallet/schemas/transaction.schema";
import { createHash, randomUUID } from "crypto";

process.env.MONGODB_URI =
  process.env.MONGODB_TEST_URI ?? "mongodb://localhost:27017/wallet_test";
process.env.CURSOR_SECRET = "test-cursor-secret-with-at-least-32-characters";
process.env.IDEMPOTENCY_TTL_SECONDS = "600";

interface TransactionPageItem {
  transactionId: string;
}

interface TransactionPageBody {
  data: TransactionPageItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface HttpPageResponse {
  body: TransactionPageBody;
}

describe("Wallet API (e2e)", () => {
  let app: INestApplication;
  let users: Model<UserDocument>;
  let transactions: Model<WalletTransactionDocument>;
  let idempotencies: Model<IdempotencyDocument>;

  async function getUserBalance(userId: string): Promise<number> {
    const user = await users.findOne({ userId }).lean().exec();

    if (!user) {
      throw new Error(`El usuario "${userId}" no existe`);
    }

    return user.balanceCents;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    users = moduleRef.get<Model<UserDocument>>(getModelToken(User.name));
    transactions = moduleRef.get<Model<WalletTransactionDocument>>(
      getModelToken(WalletTransaction.name),
    );
    idempotencies = moduleRef.get<Model<IdempotencyDocument>>(
      getModelToken(IdempotencyRecord.name),
    );
    await Promise.all([
      users.syncIndexes(),
      transactions.syncIndexes(),
      idempotencies.syncIndexes(),
    ]);
  });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      transactions.deleteMany({}),
      idempotencies.deleteMany({}),
    ]);
    await users.create({ userId: "u1", balanceCents: 10000 });
  });

  afterAll(async () => app.close());

  it("A: crea y debita con saldo suficiente", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", randomUUID())
      .send({ userId: "u1", amount: 25.5, concept: "Compra" })
      .expect(201);

    expect(res.body.transactionId).toBeDefined();
    expect(res.body.newBalance).toBe(74.5);
    expect(await transactions.countDocuments({ userId: "u1" })).toBe(1);
  });

  it("B: saldo insuficiente devuelve 422 y no cambia saldo", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", randomUUID())
      .send({ userId: "u1", amount: 101, concept: "Compra grande" })
      .expect(422);

    expect(await getUserBalance("u1")).toBe(10_000);

    expect(await transactions.countDocuments()).toBe(0);
  });

  it("C: misma key + mismo body reproduce exactamente la transacción", async () => {
    const key = randomUUID();
    const body = { userId: "u1", amount: 10, concept: "Idempotente" };
    const first = await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(await transactions.countDocuments()).toBe(1);

    expect(await getUserBalance("u1")).toBe(9_000);
  });

  it("D: misma key + body distinto devuelve 409 y no hace segundo débito", async () => {
    const key = randomUUID();
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send({ userId: "u1", amount: 10, concept: "Uno" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send({ userId: "u1", amount: 20, concept: "Dos" })
      .expect(409);

    expect(await getUserBalance("u1")).toBe(9_000);
  });

  it("E: una key en PROCESSING devuelve 409 y no ejecuta débito", async () => {
    const key = randomUUID();
    const body = { userId: "u1", amount: 10, concept: "Concurrente" };
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    await idempotencies.create({
      key,
      payloadHash,
      state: "PROCESSING",
      expiresAt: new Date(Date.now() + 600000),
    });

    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send(body)
      .expect(409);

    expect(await getUserBalance("u1")).toBe(10_000);

    expect(await transactions.countDocuments()).toBe(0);
  });

  it("F: key expirada se trata como nueva", async () => {
    const key = randomUUID();
    const body = { userId: "u1", amount: 10, concept: "Expirable" };
    const first = await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send(body)
      .expect(201);
    await idempotencies.updateOne(
      { key },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const second = await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body.transactionId).not.toBe(first.body.transactionId);
    expect(await transactions.countDocuments()).toBe(2);

    expect(await getUserBalance("u1")).toBe(8_000);
  });

  it("G: header ausente o UUID no-v4 devuelve 400", async () => {
    const body = { userId: "u1", amount: 10, concept: "Header" };
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", "not-a-uuid")
      .send(body)
      .expect(400);
  });

  it("H: 20 débitos simultáneos nunca dejan saldo negativo", async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      request(app.getHttpServer())
        .post("/api/v1/wallet/transactions")
        .set("X-Idempotency-Key", randomUUID())
        .send({ userId: "u1", amount: 10, concept: `Concurrent ${i}` }),
    );
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 422)).toHaveLength(10);

    expect(await getUserBalance("u1")).toBe(0);

    expect(await transactions.countDocuments()).toBe(10);
  });

  it("rechaza amount con más de 2 decimales y campos extra", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", randomUUID())
      .send({ userId: "u1", amount: 1.234, concept: "Bad" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/v1/wallet/transactions")
      .set("X-Idempotency-Key", randomUUID())
      .send({ userId: "u1", amount: 1, concept: "Bad", unexpected: true })
      .expect(400);
  });

  it("pagina 5 transacciones con mismo createdAt limit=2 sin repetir ni saltar", async () => {
    await transactions.deleteMany({});

    const same = new Date("2026-01-01T00:00:00.000Z");

    await transactions.insertMany(
      Array.from({ length: 5 }, (_, index) => ({
        userId: "u1",
        amountCents: 100,
        concept: `same-${index}`,
        balanceAfterCents: 9_900 - index * 100,
        createdAt: same,
        updatedAt: same,
      })),
    );

    const ids: string[] = [];

    let cursor: string | null = null;

    do {
      const url: string =
        cursor !== null
          ? `/api/v1/wallet/transactions/u1?limit=2&cursor=${encodeURIComponent(cursor)}`
          : "/api/v1/wallet/transactions/u1?limit=2";

      const page: HttpPageResponse = await request(app.getHttpServer())
        .get(url)
        .expect(200);

      ids.push(
        ...page.body.data.map(
          (item: TransactionPageItem): string => item.transactionId,
        ),
      );

      cursor = page.body.nextCursor;
    } while (cursor !== null);

    expect(ids).toHaveLength(5);

    expect(new Set(ids).size).toBe(5);
  });

  it("cursor manipulado devuelve 400 y limit > 50 se rechaza", async () => {
    await transactions.create({
      userId: "u1",
      amountCents: 100,
      concept: "cursor-1",
      balanceAfterCents: 9900,
    });
    await transactions.create({
      userId: "u1",
      amountCents: 100,
      concept: "cursor-2",
      balanceAfterCents: 9800,
    });
    const first = await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions/u1?limit=1")
      .expect(200);
    if (first.body.nextCursor) {
      await request(app.getHttpServer())
        .get(
          `/api/v1/wallet/transactions/u1?limit=1&cursor=${first.body.nextCursor}x`,
        )
        .expect(400);
    }
    await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions/u1?limit=51")
      .expect(400);
  });
});
