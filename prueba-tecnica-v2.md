# Prueba Técnica: Backend Engineer (NestJS · MongoDB · AWS)

## 📌 Información General

- **Posición:** Backend Engineer
- **Tiempo estimado:** 4 a 6 horas
- **Fecha de entrega:** Día siguiente a la recepción, antes de las 18:00
- **Formato de entrega:** Enlace a repositorio privado (GitLab) con acceso al equipo evaluador. Historial de commits incremental y descriptivo (un solo commit con todo el proyecto se considera una entrega incompleta).

### Sobre el uso de herramientas de IA

Puedes usar cualquier herramienta (IA, documentación, StackOverflow). Lo que se evalúa no es si escribiste cada línea, sino **si entiendes y puedes justificar** lo que entregas: cada decisión técnica pedida en esta prueba debe estar explicada en tus propias palabras en el README o en los archivos `.md` correspondientes, referida a *tu* código y a *este* escenario. Incluye además un archivo `AI_USAGE.md` breve indicando qué partes generaste con IA y qué corregiste o rechazaste de lo que te propuso. No penaliza; la omisión sí.

---

## 🏗️ Escenario de Negocio

Formas parte del equipo backend del módulo transaccional de **Billeteras Digitales**. El sistema maneja operaciones de alta concurrencia: canje de cupones con saldo limitado, dispersión de fondos e integración con servicios en la nube. Un doble canje o un saldo negativo es una pérdida de dinero real para la empresa.

La prueba tiene tres partes. **La Parte 2 es obligatoria y es el núcleo de la evaluación.** Si el tiempo no te alcanza, prioriza en este orden: Parte 2 → Parte 1 → Parte 3, y documenta en el README qué dejaste fuera y por qué.

---

## 🧩 Parte 1: Auditoría de Código Legacy

El siguiente fragmento representa un servicio real que está en producción y presenta fallos críticos.

```typescript
import { Controller, Post, Body, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// Cache global en memoria para "optimizar consultas"
const globalSessionCache: Record<string, any> = {};

@Injectable()
export class VoucherService {
  private readonly dbConnection: any; // Inyectado

  constructor(connection: any) {
    this.dbConnection = connection;
    // Modificación de prueba en constructor
    this.dbConnection.connectedAt = new Date();
  }

  // Genera token "único" para canje de saldo
  generateRedemptionToken(): string {
    return 'TKN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  async redeemVoucher(userId: string, voucherId: string, amount: number) {
    // 1. Guardar en cache global la última interacción del usuario
    globalSessionCache[userId] = {
      lastInteraction: new Date(),
      metadata: new Array(10000).fill('session-active-state')
    };

    // 2. Buscar si el usuario ya canjeó el voucher
    const voucher = await this.dbConnection.collection('vouchers').findOne({ _id: voucherId });
    if (!voucher || voucher.isRedeemed) {
      throw new Error('Voucher inválido o ya canjeado');
    }

    // 3. Simulación de cálculo pesado de verificación (hash síncrono bloqueante)
    for (let i = 0; i < 5000000; i++) {
      crypto.createHash('sha256').update(userId + i).digest('hex');
    }

    // 4. Actualizar estado del voucher y balance del usuario
    await this.dbConnection.collection('vouchers').updateOne(
      { _id: voucherId },
      { $set: { isRedeemed: true, redeemedBy: userId, redeemedAt: new Date() } }
    );

    const user = await this.dbConnection.collection('users').findOne({ _id: userId });
    await this.dbConnection.collection('users').updateOne(
      { _id: userId },
      { $set: { balance: (user.balance || 0) + amount } }
    );

    return { success: true, token: this.generateRedemptionToken() };
  }
}
```

### Entregable Parte 1 — archivo `AUDIT_REFACTOR.md` + código

1. **Identifica y clasifica los problemas** en una tabla con columnas: `Línea(s)` · `Problema` · `Categoría (rendimiento / seguridad / consistencia / diseño)` · `Impacto concreto en producción` · `Cómo lo detectarías en producción` (qué métrica, log o síntoma lo delataría en CloudWatch/Grafana). Se esperan al menos 6; hay más de 8.

2. **Event Loop:** describe, paso a paso, qué ocurre con el único hilo de Node.js cuando llegan 100 peticiones concurrentes a `redeemVoucher`. Indica en qué momento exacto se encolan las demás peticiones, cuántas alcanzan a ejecutar el paso 2 antes de que la primera bloquee el hilo, y qué verían los usuarios. Una descripción genérica del Event Loop no es suficiente: la respuesta debe referirse a *este* código.

3. **`Math.random()` vs `crypto.randomBytes`:** explica cómo funciona un PRNG, por qué es predecible, y qué podría hacer un atacante con los tokens generados por este servicio.

4. **Reescribe el servicio** (`src/legacy/voucher.service.ts` dentro del proyecto de la Parte 2) cumpliendo:
   - Atomicidad: el doble canje debe ser imposible **sin usar transacciones de MongoDB**. Justifica en el MD por qué es posible sin transacción y en qué caso sí las necesitarías.
   - Sin fuga de memoria ni bloqueo del Event Loop. Si el cálculo pesado es un requisito de negocio que no se puede eliminar, muestra dónde y cómo lo ejecutarías.
   - Tokens criptográficamente seguros.
   - Tipado estricto: cero `any`.

5. **Prueba de regresión:** un test (Jest) que **falle contra el código original y pase con tu versión** para el escenario de doble canje concurrente (mínimo 20 llamadas simultáneas al mismo voucher; exactamente una debe tener éxito).

---


## ⚡ Parte 2: API de Transacciones con Idempotencia y Paginación por Cursor (obligatoria)

Aplicación NestJS funcional con MongoDB. Debe poder levantarse con un solo comando (`docker compose up`) e incluir un script de seed con al menos un usuario con saldo inicial y 200 transacciones históricas.

### 2.1 `POST /api/v1/wallet/transactions`

**Body:** `{ userId: string, amount: number, concept: string }` — `amount` positivo, con máximo 2 decimales. Debita el saldo del usuario.

**Header obligatorio:** `X-Idempotency-Key` (UUID v4).

**Comportamiento esperado (cada fila debe estar cubierta por un test automatizado):**

| # | Escenario | Respuesta esperada |
|---|-----------|--------------------|
| A | Petición nueva, saldo suficiente | `201` con la transacción creada y el nuevo saldo |

| B | Saldo insuficiente | `422` con error unificado. **El saldo no cambia.** |

| C | Misma key + mismo body dentro de 10 min | Misma respuesta que la original (mismo status, mismo body, mismo `transactionId`). Sin nuevo débito ni nuevo registro. |

| D | Misma key + **body distinto** | `422` (o `409`, justifica tu elección) indicando reutilización de key con payload diferente. Sin débito. |

| E | Misma key, dos peticiones **simultáneas** (la primera todavía no terminó) | La segunda **no** debe ejecutar el débito. Documenta cómo la detectas y qué le respondes (¿espera? ¿`409`? ¿`202`?). Justifica el trade-off. |

| F | Misma key después de 10 min | Se trata como petición nueva. La expiración debe ser responsabilidad de MongoDB, no de un `setTimeout` en Node. |

| G | Header ausente o no es UUID v4 | `400` |

| H | 20 peticiones simultáneas, **distinta key**, mismo `userId`, cada una debitando más de lo que permite el saldo en conjunto | El saldo final nunca es negativo; el número de transacciones exitosas es exactamente el que el saldo permitía. |

**Restricciones:**
- La consistencia del saldo (escenario H) debe garantizarse con **una sola operación atómica de MongoDB** en la ruta crítica. Explica en el README por qué un `findOne` + `updateOne` no sirve aunque estén dentro de una transacción.
- Explica también qué pasa con tu solución si hay **5 contenedores** corriendo en paralelo. Si tu solución depende de un lock en memoria de Node.js, no es válida.
- Validación con `class-validator` + `class-transformer`. `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`.
- `ExceptionFilter` global con formato de error unificado: `{ statusCode, error, message, path, timestamp, requestId }`.

### 2.2 `GET /api/v1/wallet/transactions/:userId`

- **Prohibido `skip()`**. Keyset pagination con orden descendente por fecha de creación.
- Query params: `limit` (default 10, max 50; documenta si un valor mayor a 50 se rechaza o se ajusta) y `cursor` (opcional, opaco: el cliente no debe poder interpretarlo ni construirlo a mano).
- Respuesta: `{ data: [...], nextCursor: string | null, hasMore: boolean }`.
- **Caso obligatorio con test:** el seed debe incluir al menos **5 transacciones con exactamente el mismo `createdAt`** (mismo milisegundo). Al paginar con `limit=2` a través de ellas, ninguna transacción debe repetirse ni saltarse. Explica en el README cómo lo resuelves y qué índice necesitas para que la consulta sea eficiente con millones de registros.
- Cursor malformado o manipulado → `400`.

### 2.3 Prueba de concurrencia automatizada

Script (`npm run load-test`, en TypeScript, k6 o Artillery) que lance **50 peticiones simultáneas** al endpoint de débito con distintas keys y el mismo usuario, e imprima: saldo inicial, número de peticiones exitosas, número de rechazadas por saldo, saldo final, y una verificación explícita de que `saldo_inicial - suma(exitosas) == saldo_final`.

### 2.4 Infraestructura local

- `docker-compose.yml` con MongoDB. Si tu solución usa transacciones o change streams, la configuración debe levantar el replica set necesario; si no, indica por qué no lo necesitas.
- `README.md` con: cómo levantar, cómo correr los tests, cómo correr el load test, y una sección **"Decisiones y trade-offs"** con las justificaciones pedidas arriba.

---

## ☁️ Parte 3: Diseño de Arquitectura Cloud (AWS)

Archivo `ARCHITECTURE.md`. Escenario:

> El servicio de transacciones debe soportar ráfagas de 5,000 peticiones por minuto en quincena. Cada transacción debe emitir un comprobante en PDF, guardarlo de forma duradera y notificar por correo al usuario, sin que el endpoint supere los 150 ms de respuesta.

1. **Diagrama** (Mermaid, imagen o ASCII) con NestJS en ECS Fargate, S3, SQS y Secrets Manager / Parameter Store. Indica qué componente hace qué y por dónde pasa cada petición.
2. **Transactional Outbox:** explica cómo garantizas que ningún comprobante se pierde si el worker de correos falla. Responde explícitamente:
   - ¿Qué pasa si el proceso que publica a SQS muere **después** de enviar el mensaje pero **antes** de marcarlo como enviado en la base de datos?
   - Dado lo anterior, ¿el usuario puede recibir dos correos? ¿Cómo lo evitas?
3. **Idempotencia distribuida:** dónde viven las keys de idempotencia con 5 contenedores en paralelo, y qué cambia respecto a tu implementación de la Parte 2.
4. **Dimensionamiento:** con 5,000 rpm, un p95 de 120 ms por petición y un contenedor que atiende ~50 peticiones concurrentes, ¿cuántas tareas de Fargate necesitas? Muestra el cálculo y qué métrica usarías para el auto-scaling.

---

## 📦 Criterios de Evaluación

| Criterio | Peso | Nivel esperado |
|---|:---:|---|
| **Concurrencia e integridad de datos** | 35% | Todos los escenarios A–H cubiertos con tests que pasan. Operaciones atómicas correctas. Cursor sin duplicados con timestamps empatados. Load test consistente al ejecutarlo varias veces. |
| **Fundamentos de Node.js y seguridad** | 25% | Explicación específica del Event Loop sobre el código dado, criptografía correcta, sin fugas de memoria. |
| **Justificación técnica y trade-offs** | 20% | README y archivos `.md` con decisiones explicadas en tus propias palabras, referidas a tu código, incluyendo límites de la solución y qué harías diferente con más tiempo. |
| **Arquitectura y limpieza** | 20% | Módulos NestJS bien delimitados, DI, sin `any`, commits incrementales, proyecto que levanta con un solo comando. |

Una entrega que no pueda levantarse y ejecutarse siguiendo el README, o cuyos tests no cubran los escenarios pedidos, se considera incompleta.
