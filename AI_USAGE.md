# Uso de herramientas de IA

Utilicé una herramienta de inteligencia artificial como apoyo para analizar el código legacy, proponer alternativas de implementación, generar una primera versión de algunas pruebas y preparar la documentación. La solución final fue revisada, corregida y ejecutada localmente antes de integrarla.

## Partes en las que utilicé IA

### Análisis del cálculo pesado

Usé IA para analizar el efecto del siguiente ciclo sobre el Event Loop de Node.js:

```typescript
for (let i = 0; i < 5_000_000; i += 1) {
  crypto
    .createHash('sha256')
    .update(userId + i)
    .digest('hex');
}
```

La conclusión fue que el ciclo es síncrono y bloquea el único hilo que ejecuta JavaScript. Mientras se ejecuta, Node.js no puede continuar atendiendo solicitudes, respuestas de MongoDB ni timers. La propuesta aceptada fue eliminar el cálculo cuando no aporta valor o enviarlo a `worker_threads` si fuera un requisito obligatorio.

### Refactor del servicio de vouchers

La IA ayudó a proponer el uso de `findOneAndUpdate` con el filtro `isRedeemed: false`. Revisé y conservé esta propuesta porque MongoDB evalúa la condición y modifica el voucher en una sola operación atómica. También se sustituyó `Math.random()` por `crypto.randomBytes()` para generar tokens no predecibles.

### Pruebas automatizadas

Usé IA para preparar una primera versión de las pruebas Jest de:

- Doble canje con 20 solicitudes concurrentes.
- Escenarios A-H del endpoint de transacciones.
- Idempotencia con la misma llave y payload.
- Reutilización de llave con un payload diferente.
- Saldo insuficiente.
- Paginación con cinco timestamps iguales.
- Cursor manipulado.
- Validación del header UUID v4.

Separé la prueba del código original de la suite normal. `npm run test:original` falla intencionalmente porque encuentra 20 canjes exitosos; `npm run test:fixed` comprueba que la versión corregida permite exactamente uno.

### Seed y prueba de carga

La IA ayudó a preparar el seed con `seed-user`, `load-user` y 200 transacciones históricas. Revisé que cinco transacciones compartieran exactamente el mismo `createdAt` para probar el desempate mediante `_id`.

También se utilizó IA para generar `npm run load-test`. El script restablece `load-user` con `$100.00`, envía 50 débitos simultáneos de `$3.00`, usa un UUID v4 diferente en cada petición y verifica que `$100.00 - $99.00 = $1.00`.

### Idempotencia y paginación

La IA apoyó en la estructura inicial de los estados `PROCESSING` y `COMPLETED`, el hash SHA-256 del payload y el índice TTL de MongoDB. Elegí responder `409 Conflict` cuando una llave está en proceso o se reutiliza con otro payload, porque existe un conflicto y no quiero mantener conexiones abiertas esperando.

Para la paginación acepté ordenar por `createdAt` y `_id`. También se implementó un cursor opaco cifrado y autenticado mediante AES-256-GCM.

## Propuestas que corregí o rechacé

- Rechacé acreditar el `amount` enviado por el cliente durante el canje. En la Parte 1, el monto debe salir del voucher persistido.
- Corregí la prueba inicial que sólo comprobaba la versión nueva, pero no demostraba el fallo del código original.
- Corregí schemas con propiedades que aceptan `null`, indicando explícitamente el tipo en `@Prop`.

Validación personal

Después de aplicar las propuestas, revisé el código y utilicé estos comandos para validar la entrega:

```bash
npm run build
npm test
npm run test:original
npm run test:fixed
npm run test:e2e
npm run load-test
docker compose up --build
```

La IA se utilizó como herramienta de apoyo. Las decisiones finales, los ajustes de compatibilidad y la comprobación de resultados se realizaron sobre el proyecto entregado.