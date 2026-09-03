/**
 * Valida los parámetros de paginación del historial.
 * limit se rechaza fuera de 1..50 y cursor se mantiene como cadena opaca cuya validación
 * criptográfica ocurre posteriormente en CursorService.
 */
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListTransactionsDto {
  @IsOptional()
  @Transform(({ value }: { value: string | undefined }) => value === undefined ? 10 : Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @IsOptional()
  @IsString()
  cursor?: string;
}
