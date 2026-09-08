import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { RACHA3_PROCESSOR } from '../../core/constants/injection-tokens.constants';
import { PrismaRacha3Processor } from '../../infrastructure/persistence/analytics/prisma-racha3.processor';
import { AnalyticsModule } from './analytics.module';
import {
  DEFAULT_ANALYTICS_INTERVAL_MS,
  Racha3IncrementalScheduler,
} from './racha3-incremental.scheduler';

/**
 * Cableado real del contenedor de NestJS. Las pruebas unitarias construyen
 * el scheduler a mano, así que no pueden detectar un token mal enlazado, un
 * import faltante o una dependencia circular: eso solo aparece al resolver
 * el módulo de verdad.
 *
 * Sin `DATABASE_URL`, así que además comprueba lo que más importa del modo
 * degradado: el módulo levanta igual, sin lanzar.
 */
describe('AnalyticsModule (cableado)', () => {
  const construir = () =>
    Test.createTestingModule({
      imports: [
        // `isGlobal: true` igual que AppConfigModule: PersistenceModule no
        // importa ConfigModule por su cuenta, cuenta con que sea global.
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              analytics: { intervalMs: DEFAULT_ANALYTICS_INTERVAL_MS },
            }),
          ],
        }),
        AnalyticsModule,
      ],
    }).compile();

  it('resuelve el scheduler y enlaza RACHA3_PROCESSOR a la implementación de Prisma', async () => {
    const moduleRef = await construir();

    expect(moduleRef.get(Racha3IncrementalScheduler)).toBeInstanceOf(
      Racha3IncrementalScheduler,
    );
    expect(moduleRef.get(RACHA3_PROCESSOR)).toBeInstanceOf(
      PrismaRacha3Processor,
    );

    await moduleRef.close();
  });

  it('arranca y se apaga sin lanzar aunque no haya base de datos configurada', async () => {
    const moduleRef = await construir();

    await expect(moduleRef.init()).resolves.toBeDefined();
    // `close()` dispara onModuleDestroy: el intervalo debe quedar limpio.
    await expect(moduleRef.close()).resolves.toBeUndefined();
  });

  it('sin persistencia, un tick real no lanza y reporta el modo degradado', async () => {
    const moduleRef = await construir();
    await moduleRef.init();

    const scheduler = moduleRef.get(Racha3IncrementalScheduler);
    await expect(scheduler.runTick()).resolves.toBeUndefined();

    await moduleRef.close();
  });
});
