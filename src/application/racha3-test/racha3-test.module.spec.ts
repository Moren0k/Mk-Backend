import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import {
  NOTIFICATION_CHANNELS,
  RACHA3_TEST_DEBUG_CHANNEL,
  STRATEGIES,
} from '../../core/constants/injection-tokens.constants';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { RACHA3_TEST_ID } from '../../core/racha3-test/types/racha3-test.type';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { TelegramChannel } from '../../infrastructure/telegram/telegram.channel';
import { NotificationModule } from '../notification/notification.module';
import { Racha3TestCoordinator } from './racha3-test.coordinator';
import { Racha3TestDebugNotifier } from './racha3-test-debug.notifier';
import { Racha3TestEvidenceProvider } from './racha3-test.evidence-provider';
import { Racha3TestModule } from './racha3-test.module';
import { Racha3TestSimulationRegistry } from './racha3-test-simulation.registry';

/**
 * Cableado real del contenedor. Los tests unitarios construyen el
 * coordinator a mano, así que no detectan un token mal enlazado ni un
 * import faltante — eso sólo aparece resolviendo el módulo de verdad (ya
 * pasó dos veces en Analytics con `PersistenceModule`).
 *
 * Compila también `NotificationModule` en el mismo contenedor, porque la
 * propiedad de aislamiento más importante es negativa: el canal DEBUG NO
 * debe estar en `NOTIFICATION_CHANNELS`.
 */
describe('Racha3TestModule (cableado)', () => {
  const construir = (racha3Test: Record<string, unknown>) =>
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
              racha3Test,
            }),
          ],
        }),
        NotificationModule,
        Racha3TestModule,
      ],
    }).compile();

  const canalDebug = (m: TestingModule): NotificationChannel =>
    m.get<NotificationChannel>(RACHA3_TEST_DEBUG_CHANNEL);

  /** Lo mínimo que `TelegramChannel.supports()` mira: metadata.strategyId. */
  const notificacionDe = (strategyId: string) =>
    ({ metadata: { strategyId } }) as unknown as Parameters<
      NotificationChannel['supports']
    >[0];

  it('resuelve todos sus providers sin base de datos configurada', async () => {
    const m = await construir({ enabled: false });

    expect(m.get(Racha3TestCoordinator)).toBeInstanceOf(Racha3TestCoordinator);
    expect(m.get(Racha3TestSimulationRegistry)).toBeInstanceOf(
      Racha3TestSimulationRegistry,
    );
    expect(m.get(Racha3TestEvidenceProvider)).toBeInstanceOf(
      Racha3TestEvidenceProvider,
    );
    expect(m.get(Racha3TestDebugNotifier)).toBeInstanceOf(
      Racha3TestDebugNotifier,
    );
    expect(canalDebug(m)).toBeInstanceOf(TelegramChannel);

    await m.close();
  });

  it('arranca y se apaga sin lanzar', async () => {
    const m = await construir({ enabled: false });

    await expect(m.init()).resolves.toBeDefined();
    await expect(m.close()).resolves.toBeUndefined();
  });

  it('el canal DEBUG tiene su propio channelType', async () => {
    const m = await construir({ enabled: true });

    expect(canalDebug(m).getChannelType()).toBe(
      NotificationChannelType.TELEGRAM_RACHA3_TEST,
    );

    await m.close();
  });

  describe('AISLAMIENTO del cableado', () => {
    it('el canal DEBUG NO está en NOTIFICATION_CHANNELS', async () => {
      const m = await construir({ enabled: true });

      const canales = m.get<readonly NotificationChannel[]>(
        NOTIFICATION_CHANNELS,
      );
      const tipos = canales.map((c) => c.getChannelType());

      // Si estuviera acá, `NotificationCoordinator.dispatchToAll()` le
      // mandaría las alertas reales de streak-3/streak-4.
      expect(tipos).toEqual([
        NotificationChannelType.TELEGRAM,
        NotificationChannelType.TELEGRAM_PRUEBAS,
      ]);
      expect(tipos).not.toContain(NotificationChannelType.TELEGRAM_RACHA3_TEST);
      expect(canales).not.toContain(canalDebug(m));

      await m.close();
    });

    it('`racha-3-test` NO está registrada en STRATEGIES', async () => {
      const m = await construir({ enabled: true });

      const estrategias = m.get<readonly Strategy[]>(STRATEGIES);
      const ids = estrategias.map((s) => s.id);

      // Es lo que impide que `OperationCoordinator` cree una operación real:
      // si apareciera acá, el experimento estaría apostando.
      expect(ids).not.toContain(RACHA3_TEST_ID);
      expect(ids).toContain('streak-3');

      await m.close();
    });

    it('el canal DEBUG se apaga solo con RACHA3_TEST_ENABLED', async () => {
      const apagado = await construir({ enabled: false });
      expect(canalDebug(apagado).enabled()).toBe(false);
      await apagado.close();

      // Los canales de producción arrancan inactivos por
      // StrategyChannelRegistry; el DEBUG queda activo igual, sin depender
      // de esa configuración.
      const encendido = await construir({ enabled: true });
      expect(canalDebug(encendido).enabled()).toBe(true);

      const produccion = encendido.get<readonly NotificationChannel[]>(
        NOTIFICATION_CHANNELS,
      );
      expect(produccion.map((c) => c.enabled())).toEqual([false, false]);

      await encendido.close();
    });

    it('el canal DEBUG acepta cualquier estrategia sin consultar el registro', async () => {
      const m = await construir({ enabled: true });
      const canal = canalDebug(m);

      // `supports()` no filtra: el destino ya está elegido a propósito.
      // Los canales de producción, en cambio, dicen `false` porque
      // `streak-3` no está asignada a ninguno.
      expect(canal.supports(notificacionDe('streak-3'))).toBe(true);
      expect(canal.supports(notificacionDe(RACHA3_TEST_ID))).toBe(true);

      for (const p of m.get<readonly NotificationChannel[]>(
        NOTIFICATION_CHANNELS,
      )) {
        expect(p.supports(notificacionDe('streak-3'))).toBe(false);
      }

      await m.close();
    });
  });

  describe('configuración del bot/chat DEBUG', () => {
    it('sin RACHA3_TEST_TELEGRAM_* cae a los de pruebas', async () => {
      const m = await construir({ enabled: true, telegram: {} });

      // Comparte destino sin compartir interruptor: el canal DEBUG queda
      // habilitado aunque el de pruebas esté inactivo.
      expect(canalDebug(m).enabled()).toBe(true);

      await m.close();
    });

    it('con bot/chat propios usa los propios', async () => {
      const m = await construir({
        enabled: true,
        telegram: { botToken: 'debug-token', chatId: '-300' },
      });

      expect(canalDebug(m).enabled()).toBe(true);

      await m.close();
    });

    it('sin ningún token el canal queda deshabilitado, no lanza', async () => {
      const m = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                analytics: { intervalMs: 60_000 },
                telegram: { pruebas: {} },
                racha3Test: { enabled: true, telegram: {} },
              }),
            ],
          }),
          Racha3TestModule,
        ],
      }).compile();

      expect(canalDebug(m).enabled()).toBe(false);

      await m.close();
    });
  });
});
