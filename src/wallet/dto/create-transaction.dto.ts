/**
 * Contratos de entrada para creación de transacciones e idempotencia.
 * Las reglas declarativas permiten que ValidationPipe rechace montos inválidos, UUIDs
 * incorrectos y payloads fuera del contrato antes de ejecutar lógica de negocio.
 */
import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  userId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  concept!: string;
}

export class IdempotencyKeyDto {
  @IsUUID('4')
  key!: string;
}
