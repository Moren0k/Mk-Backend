import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { EngineHealth } from './engine-health';
import { HealthSnapshot } from './types/health-snapshot.type';

/**
 * Compone el snapshot de `EngineHealth` con la salud de la base de datos
 * (`PrismaService.checkHealth()`, hoy desconectada de cualquier flujo del
 * motor) para `GET /api/v1/health` (Mk-Api.md Anexo D §7: "la salud de la
 * DB importa por sí misma, independiente de si hoy alimenta algo").
 *
 * Vive en `application/` (no en `api/`) porque compone dos fuentes ya
 * existentes sin agregar ninguna regla de negocio nueva — mismo criterio
 * que `EngineHealth` ya usa al leer `GameEventCollector` directamente.
 *
 * `ok` refleja únicamente si el motor sigue recibiendo jugadas
 * (`collectorConnected`): la base de datos es una dependencia opcional del
 * proyecto (ver README.md — sin `DATABASE_URL` el motor funciona igual),
 * así que su caída se reporta en `db`, pero no apaga el healthcheck general.
 */
@Injectable()
export class HealthSnapshotService {
  constructor(
    private readonly engineHealth: EngineHealth,
    private readonly prismaService: PrismaService,
  ) {}

  async getSnapshot(): Promise<HealthSnapshot> {
    const engine = this.engineHealth.getSnapshot();
    const db = await this.prismaService.checkHealth();

    return {
      ok: engine.collectorConnected,
      collectorConnected: engine.collectorConnected,
      lastGameReceivedAt: engine.lastGameReceivedAt,
      gamesInMemory: engine.gamesInMemory,
      activeOperations: engine.activeOperations,
      registeredStrategies: engine.registeredStrategies,
      registeredChannels: engine.registeredChannels,
      lastError: engine.lastError,
      db,
    };
  }
}
