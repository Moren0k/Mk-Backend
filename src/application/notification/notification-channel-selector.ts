import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { StrategyGroup } from '../../core/strategy/strategy-group';

/**
 * Elige, entre los canales registrados, los que corresponden a un grupo de
 * negocio ("oficial"/"pruebas") en vez de una instancia concreta — mismo
 * criterio que ya usaba SummaryReportService.selectChannels, ahora
 * compartido con ReportNotificationCoordinator para que el reporte horario
 * también pueda dirigirse explícitamente al canal oficial sin depender de
 * `supports()`.
 */
export function selectChannelsByGroup(
  channels: readonly NotificationChannel[],
  group: StrategyGroup,
): readonly NotificationChannel[] {
  const type =
    group === 'oficial'
      ? NotificationChannelType.TELEGRAM
      : NotificationChannelType.TELEGRAM_PRUEBAS;

  return channels.filter((channel) => channel.getChannelType() === type);
}
