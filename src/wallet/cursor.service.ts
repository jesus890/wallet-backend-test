/**
 * Crea y valida cursores opacos para paginación keyset.
 * AES-256-GCM cifra el contenido y además autentica su integridad, de modo que el cliente
 * no pueda construir ni modificar manualmente createdAt/_id sin provocar un error 400.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Types } from 'mongoose';

export interface CursorPayload {
  createdAt: string;
  id: string;
}

@Injectable()
export class CursorService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('CURSOR_SECRET') ?? 'development-only-secret-change-me';
    this.key = createHash('sha256').update(secret).digest();
  }

  encode(payload: CursorPayload): string {
    // GCM recomienda un IV único de 12 bytes. No es secreto y se almacena junto al cursor.
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    // El authTag permite detectar cualquier alteración de los bytes cifrados.
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  decode(cursor: string): CursorPayload {
    try {
      const raw = Buffer.from(cursor, 'base64url');
      if (raw.length < 29) throw new Error('cursor too short');
      // El formato binario es: [12 bytes IV][16 bytes authTag][payload cifrado].
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const encrypted = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(plaintext) as Partial<CursorPayload>;
      if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt)) || !Types.ObjectId.isValid(parsed.id)) {
        throw new Error('invalid payload');
      }
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor malformado o manipulado');
    }
  }
}
