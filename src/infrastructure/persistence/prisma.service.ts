import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { PersistenceHealthSnapshot } from './persistence-health.type';

/**
 * Único punto de acceso a PostgreSQL (Supabase) del proyecto.
 *
 * A diferencia de GameEventCollector o TelegramChannel, esta capa hoy no
 * participa del flujo de eventos: nadie la inyecta todavía. Existe para
 * que un futuro servicio de captura de jugadas (u otro consumidor) solo
 * necesite importar PersistenceModule, sin resolver de nuevo conexión,
 * ciclo de vida o health check.
 *
 * DATABASE_URL/DIRECT_URL ausentes (el caso de todos los despliegues
 * actuales) o una conexión fallida al arrancar nunca lanzan desde
 * onModuleInit: el cliente queda deshabilitado y el resto del motor
 * (detección de patrones, operaciones, alertas) sigue funcionando exactamente
 * igual, sin depender de esta capa.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private client: PrismaClient | undefined;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const databaseUrl = this.configService.get<string>('database.url');

    if (!databaseUrl) {
      this.logger.warn(
        'DATABASE_URL no configurada: persistencia deshabilitada (el motor sigue funcionando sin ella).',
      );
      return;
    }

    try {
      const client = new PrismaClient({ datasourceUrl: databaseUrl });
      await client.$connect();
      this.client = client;
      this.logger.log('Conexión con PostgreSQL (Supabase) establecida.');
    } catch (error) {
      this.logger.error(
        'No se pudo conectar a PostgreSQL; persistencia deshabilitada.',
        error as Error,
      );
      this.client = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  /** Solo-consulta: nunca lanza, refleja el estado real de la conexión. */
  async checkHealth(): Promise<PersistenceHealthSnapshot> {
    if (!this.client) {
      return {
        ok: false,
        error:
          'Cliente Prisma no disponible (DATABASE_URL ausente o conexión fallida).',
      };
    }

    const startedAt = Date.now();

    try {
      await this.client.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /**
   * Acceso al cliente para futuros repositorios (p. ej. un capturador de
   * jugadas). Lanza si la persistencia no está disponible, en vez de
   * devolver `undefined` en silencio, para que el error aparezca en el
   * punto de uso.
   */
  getClient(): PrismaClient {
    if (!this.client) {
      throw new Error(
        'PrismaClient no está disponible: revisa DATABASE_URL y la conexión con Supabase.',
      );
    }

    return this.client;
  }
}
