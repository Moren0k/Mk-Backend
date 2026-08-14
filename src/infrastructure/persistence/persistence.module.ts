import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Infraestructura de persistencia (PostgreSQL vía Supabase + Prisma).
 *
 * Módulo desacoplado del resto del motor: no lo importan ni lo conocen
 * StrategyModule, OperationModule ni NotificationModule. Hoy no expone
 * modelos (ver prisma/schema.prisma, deliberadamente vacío); un futuro
 * servicio de captura de jugadas solo necesita importar este módulo e
 * inyectar PrismaService.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}
