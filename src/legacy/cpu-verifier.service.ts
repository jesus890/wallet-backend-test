/**
 * Aísla el cálculo CPU-intensivo heredado en un Worker Thread.
 * El objetivo es conservar el requisito de negocio sin bloquear el Event Loop principal
 * de Node.js mientras se ejecutan millones de operaciones SHA-256.
 */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Worker } from 'worker_threads';

export interface CpuVerifierContract {
  verify(userId: string): Promise<void>;
}

@Injectable()
export class CpuVerifierService implements CpuVerifierContract {
  verify(userId: string): Promise<void> {
    const source = `
      const { parentPort, workerData } = require('worker_threads');
      const crypto = require('crypto');
      for (let i = 0; i < 5000000; i++) {
        crypto.createHash('sha256').update(workerData.userId + i).digest('hex');
      }
      parentPort.postMessage('done');
    `;

    return new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: { userId } });
      worker.once('message', () => resolve());
      worker.once('error', (error: Error) => reject(
        new InternalServerErrorException(`CPU verification failed: ${error.message}`),
      ));
      worker.once('exit', (code: number) => {
        if (code !== 0) {
          reject(new InternalServerErrorException(`CPU worker exited with code ${code}`));
        }
      });
    });
  }
}
