import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import {
  NOTIFICATION_CHANNELS,
  STRATEGIES,
} from '../../core/constants/injection-tokens.constants';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { TRES_AL_TRES_ID } from '../../core/tres-al-tres/types/tres-al-tres.type';
import { NotificationModule } from '../notification/notification.module';
import { TresAlTresCoordinator } from './tres-al-tres.coordinator';
import { TresAlTresEvidenceProvider } from './tres-al-tres.evidence-provider';
import { TresAlTresModule } from './tres-al-tres.module';

/**
 * Cableado real del contenedor. Los tests unitarios construyen el
 * coordinator a mano, así que no detectan un token mal enlazado ni un
 * import faltante — eso sólo aparece resolviendo el módulo de verdad.
 *
 * Compila también `NotificationModule` para comprobar que 3al3 usa el
 * pipeline de producción y no un canal propio.
 */
describe('TresAlTresModule (cableado)', () => {
  const construir = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              analytics: { intervalMs: 60_000 },
              telegram: {
                botToken: 'oficial-token',
                chatId: '-100',
                pruebas: {
                  botToken: 'pruebas-token',
                  chatId: '-200',
                  enabled: true,
                },
              },
            }),
          ],
        }),
        NotificationModule,
        TresAlTresModule,
      ],
    }).compile();

  it('resuelve sus providers sin base de datos ni configuración propia', async () => {
    const m = await construir();

    expect(m.get(TresAlTresCoordinator)).toBeInstanceOf(TresAlTresCoordinator);
    expect(m.get(TresAlTresEvidenceProvider)).toBeInstanceOf(
      TresAlTresEvidenceProvider,
    );

    await m.close();
  });

  it('arranca y se apaga sin lanzar', async () => {
    const m = await construir();

    await expect(m.init()).resolves.toBeDefined();
    await expect(m.close()).resolves.toBeUndefined();
  });

  it('3al3 SÍ está en STRATEGIES, para poder asignarla a un canal', () => {
    // Es lo que la hace aparecer en GET /api/v1/strategies y por tanto en el
    // selector del frontend. Sin esto no habría forma de encenderla.
    return construir().then(async (m) => {
      const ids = m.get<readonly Strategy[]>(STRATEGIES).map((s) => s.id);

      expect(ids).toContain(TRES_AL_TRES_ID);
      expect(ids).toContain('streak-3');
      expect(ids).toContain('streak-4');
      expect(ids).toHaveLength(3);

      await m.close();
    });
  });

  it('su evaluate() nunca dispara: la detección real es asíncrona', async () => {
    const m = await construir();
    const tresAlTres = m
      .get<readonly Strategy[]>(STRATEGIES)
      .find((s) => s.id === TRES_AL_TRES_ID)!;

    // StrategyCoordinator la recorre en cada jugada; tiene que ser inerte
    // para que no haya doble señal con el coordinator propio.
    expect(tresAlTres.evaluate(undefined as never).triggered).toBe(false);
    expect(tresAlTres.enabled()).toBe(true);

    await m.close();
  });

  it('NO registra ningún canal de notificación propio', async () => {
    const m = await construir();

    // 3al3 usa el pipeline de producción: sus alertas salen por los mismos
    // dos canales que el resto, con el mismo formato.
    const tipos = m
      .get<readonly NotificationChannel[]>(NOTIFICATION_CHANNELS)
      .map((c) => c.getChannelType());

    expect(tipos).toEqual([
      NotificationChannelType.TELEGRAM,
      NotificationChannelType.TELEGRAM_PRUEBAS,
    ]);

    await m.close();
  });
});
