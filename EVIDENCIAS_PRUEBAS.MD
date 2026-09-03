# Evidencias de pruebas

## Resumen A-H

| Caso | Prueba | Resultado esperado |
|---|---|---|
| A | Petición nueva con saldo | `201`, transacción creada y nuevo saldo |
| B | Monto superior al saldo | `422`, cero movimientos y saldo intacto |
| C | Misma key y mismo body | Mismo status, body y `transactionId`; un débito |
| D | Misma key y body diferente | `409`, sin segundo débito |
| E | Key existente en `PROCESSING` | `409`, sin débito |
| F | Key con `expiresAt` vencido | Se crea una transacción nueva |
| G | Header ausente o UUID no v4 | `400` |
| H | 20 débitos de `$10` sobre `$100` | 10 éxitos, 10 rechazos y saldo cero |

Ejecutar:

```bash
npm run test:e2e
```

La suite también comprueba montos con más de dos decimales, propiedades adicionales, límite mayor a 50, cursor manipulado y cinco timestamps empatados.

## Regresión legacy

```bash
npm run test:original
```

Resultado intencional:

```text
Expected length: 1
Received length: 20
```

El mismo contrato contra el servicio corregido:

```bash
npm run test:fixed
```

Resultado esperado: un éxito y 19 rechazos.

## Paginación con timestamps iguales

La prueba inserta cinco transacciones con el mismo `createdAt`, recorre páginas de dos elementos y acumula sus IDs:

```typescript
expect(ids).toHaveLength(5);
expect(new Set(ids).size).toBe(5);
```

La combinación `(createdAt, _id)` impide repeticiones y omisiones.

## Load test

Con la API levantada:

```bash
npm run load-test
```

El script restablece `load-user` con `$100.00`, envía 50 débitos simultáneos de `$3.00` y usa una llave UUID v4 distinta en cada solicitud.

Resultado esperado:

```text
Peticiones exitosas (201): 33
Rechazadas por saldo (422): 17
Suma debitada: 99.00
Saldo final: 1.00
saldo_inicial - suma(exitosas) == saldo_final: OK
Saldo final no negativo: OK
Cantidad de éxitos y rechazos correcta: OK
```

El saldo final se consulta directamente en MongoDB porque el orden de terminación de las respuestas concurrentes no representa necesariamente el orden de las escrituras.

## Verificación manual

Contar las 200 transacciones del seed:

```bash
docker compose exec mongo mongosh wallet --quiet --eval \
  'db.transactions.countDocuments({userId:"seed-user"})'
```

Consultar el saldo posterior a la carga:

```bash
docker compose exec mongo mongosh wallet --quiet --eval \
  'db.users.findOne({userId:"load-user"},{_id:0,userId:1,balanceCents:1})'
```

Comprobar índices:

```bash
docker compose exec mongo mongosh wallet --quiet --eval \
  'db.transactions.getIndexes()'

docker compose exec mongo mongosh wallet --quiet --eval \
  'db.idempotency_keys.getIndexes()'
```

## Lista de comprobación antes de entregar

- [ ] `docker compose up --build` levanta MongoDB, ejecuta el seed e inicia la API.
- [ ] `npm run build` termina sin errores.
- [ ] `npm test` termina en verde.
- [ ] `npm run test:original` falla mostrando 20 éxitos; se documenta como demostración intencional.
- [ ] `npm run test:fixed` termina en verde.
- [ ] `npm run test:e2e` cubre A-H y paginación.
- [ ] `npm run load-test` termina con tres verificaciones `OK`.
- [ ] El repositorio conserva commits incrementales y descriptivos.



## Documentación complementaria

Para consultar las pruebas manuales en Insomnia, capturas de resultados, respuestas de la API y explicaciones paso a paso, revisa el siguiente documento:

[Consultar documentación completa en PDF](docs/documentacion.pdf)

El PDF complementa estas evidencias con ejemplos visuales de los escenarios A–H, la paginación por cursor y la prueba de concurrencia.