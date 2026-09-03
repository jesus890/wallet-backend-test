# Wallet Backend Test — NestJS + MongoDB

Implementación de la prueba de Billeteras Digitales. Incluye auditoría/refactor del legacy, API transaccional con idempotencia, keyset pagination, seed de 200 transacciones, tests A-H y load test de 50 requests concurrentes.

## Requisitos

- Docker Desktop con `docker compose`.
- Opcional para ejecución local: Node.js 20+ y npm.

## Inicio rápido

La forma reproducible de levantar API + MongoDB es:

```bash
cp .env.example .env
docker compose up --build -d
```

API:

```text
http://localhost:3000/api/v1
```

Ejecuta el seed dentro de Docker:

```bash
docker compose --profile tools run --rm seed
```

El seed crea:

- `seed-user`, saldo de 500.00.
- `load-user`, saldo de 100.00.
- 200 transacciones históricas para `seed-user`.
- Las primeras 5 del conjunto de prueba comparten exactamente el mismo `createdAt`.

Para apagar:

```bash
docker compose down
```

Para borrar también los datos Mongo:

```bash
docker compose down -v
```

## Instalación y ejecución local

```bash
npm install
cp .env.example .env
docker compose up -d mongo
npm run seed
npm run start:dev
```

`.env` local:

```dotenv
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wallet
CURSOR_SECRET=change-me-for-a-long-random-secret-at-least-32-characters
IDEMPOTENCY_TTL_SECONDS=600
```

## Endpoints

### POST `/api/v1/wallet/transactions`

Header obligatorio:

```text
X-Idempotency-Key: UUID-v4
```

Body:

```json
{
  "userId": "seed-user",
  "amount": 10.50,
  "concept": "Pago de servicio"
}
```

Ejemplo cURL:

```bash
curl -i -X POST http://localhost:3000/api/v1/wallet/transactions \
  -H 'Content-Type: application/json' \
  -H "X-Idempotency-Key: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  -d '{"userId":"seed-user","amount":10.50,"concept":"Pago de servicio"}'
```

### GET `/api/v1/wallet/transactions/:userId`

```bash
curl 'http://localhost:3000/api/v1/wallet/transactions/seed-user?limit=10'
```

Para la siguiente página usa `nextCursor` literalmente:

```bash
curl --get 'http://localhost:3000/api/v1/wallet/transactions/seed-user' \
  --data-urlencode 'limit=10' \
  --data-urlencode 'cursor=CURSOR_DEVUELTO_POR_LA_API'
```

`limit` tiene default 10. Si es mayor a 50 **se rechaza con 400** en vez de ajustarse silenciosamente.

## Tests

Unitario de regresión del voucher:

```bash
npm test
```

E2E A-H y paginación (requiere Mongo levantado en `localhost:27017`):

```bash
docker compose up -d mongo
npm run test:e2e
```

Para usar otra base de pruebas:

```bash
MONGODB_TEST_URI=mongodb://localhost:27017/wallet_test npm run test:e2e
```

Los tests cubren:

- A: 201 y nuevo saldo.
- B: 422 y saldo intacto.
- C: replay idempotente, mismo body y transactionId.
- D: misma key con payload distinto -> 409.
- E: key en `PROCESSING` -> 409 sin débito.
- F: key expirada -> petición nueva.
- G: header ausente/no UUID v4 -> 400.
- H: 20 keys distintas concurrentes sin saldo negativo.
- Validación de 2 decimales y `forbidNonWhitelisted`.
- Paginación de 5 registros con idéntico `createdAt` usando `limit=2`.
- Cursor manipulado -> 400.

## Load test — 50 peticiones simultáneas

Primero API + Mongo:

```bash
docker compose up --build -d
npm install
npm run load-test
```

El script reinicia únicamente `load-user` a 100.00 y envía 50 débitos simultáneos de 3.00, cada uno con UUID v4 diferente. El resultado esperado es:

```text
Saldo inicial: 100.00
Peticiones exitosas (201): 33
Rechazadas por saldo (422): 17
Suma debitada exitosamente: 99.00
Saldo final: 1.00
Verificación: 100.00 - 99.00 == 1.00 -> OK
```

## Decisiones y trade-offs

### 1. Dinero en centavos enteros

El API recibe `number` porque así lo exige el contrato, pero internamente convierte `10.50` a `1050`. Esto evita utilizar aritmética binaria de punto flotante para el estado financiero. `class-validator` exige monto positivo y máximo 2 decimales.

### 2. Escenario H: un solo update atómico

La ruta crítica usa:

```ts
findOneAndUpdate(
  { userId, balanceCents: { $gte: amountCents } },
  { $inc: { balanceCents: -amountCents } },
  { new: true },
)
```

La condición y el débito forman **una única operación atómica sobre el documento del usuario**. Si el saldo deja de cumplir `$gte` después de los débitos ganadores, las solicitudes restantes reciben `null` y responden 422. No existe un instante en que el saldo pueda bajar de cero.

Un `findOne()` seguido de `updateOne()` es vulnerable a TOCTOU: varias requests leen el mismo saldo antes de que una escriba. Meter ese patrón en una transacción no satisface la restricción de "una sola operación atómica" y añade abortos/reintentos bajo contención. Una transacción correctamente implementada puede aportar atomicidad multi-documento, pero la decisión de si el saldo alcanza debe seguir estando en el predicado del update para esta solución.


### 4. Idempotencia

Al iniciar una petición se crea un registro:

```text
PROCESSING -> COMPLETED
```

El hash SHA-256 se calcula sobre una representación canónica de `userId`, `amount` y `concept`.

- misma key + mismo hash + `COMPLETED`: reproduce la respuesta 201 original.
- misma key + hash diferente: **409 Conflict**, porque existe conflicto de identidad de la operación, no un error semántico del monto.
- misma key + `PROCESSING`: **409 Conflict**. Elegí no hacer polling ni mantener abierta la segunda conexión. El cliente puede reintentar; se garantiza que la segunda request no ejecuta el débito.

### 5. Expiración a 10 minutos

`expiresAt` tiene un índice TTL:

```ts
{ expiresAt: 1 }, { expireAfterSeconds: 0 }
```

MongoDB se encarga de la limpieza; no hay `setTimeout` en Node. Como el monitor TTL es asíncrono y no garantiza borrar exactamente al segundo 600, antes de reclamar una key se hace `deleteOne({ key, expiresAt: { $lte: now } })`. Es una operación en MongoDB que define la expiración semántica exacta y evita que una fila físicamente pendiente de limpieza bloquee una nueva operación después de los 10 minutos.

### 6. Consistencia entre balance y colección `transactions`

Para H no hacen falta transacciones: la propiedad crítica `balance >= 0` está en un único documento y la mutación es atómica. Este proyecto mantiene Docker simple, sin replica set.

Existe una ventana pequeña después del débito y antes de insertar `transactions`. Se implementa compensación best-effort si la inserción falla. Si el requisito real exige **all-or-nothing incluso ante crash del proceso en esa ventana**, entonces sí configuraría Mongo como replica set y envolvería el update condicional del usuario + insert de transacción + finalización de idempotencia en una transacción. La Parte 1, en cambio, prohíbe explícitamente usar transacciones para impedir el doble canje y por eso usa compare-and-set sobre el voucher.

### 7. Cursor opaco y estable ante empates

No se usa `skip()`. La consulta ordena:

```text
createdAt DESC, _id DESC
```

El índice requerido es:

```js
{ userId: 1, createdAt: -1, _id: -1 }
```

El siguiente page predicate es conceptualmente:

```text
createdAt < cursor.createdAt
OR
(createdAt == cursor.createdAt AND _id < cursor._id)
```

Por eso 5 transacciones con el mismo milisegundo no se repiten ni se saltan.

El cursor no es Base64 de JSON visible: se cifra y autentica con AES-256-GCM usando `CURSOR_SECRET`. Si se altera un byte, falla la autenticación y se responde 400.

### 8. Error unificado y requestId

El `ExceptionFilter` global devuelve:

```json
{
  "statusCode": 422,
  "error": "UNPROCESSABLE_ENTITY",
  "message": "Saldo insuficiente",
  "path": "/api/v1/wallet/transactions",
  "timestamp": "2026-09-03T00:00:00.000Z",
  "requestId": "..."
}
```

`RequestIdMiddleware` reutiliza `X-Request-Id` si llega o crea un UUID nuevo, y lo devuelve también como header de respuesta.

## Parte 1

La auditoría completa está en `AUDIT_REFACTOR.md`. El refactor está en `src/legacy/voucher.service.ts` y mueve la carga CPU a `worker_threads`, usa tokens criptográficos y compare-and-set para el voucher.


