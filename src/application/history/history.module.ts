import { Module } from '@nestjs/common';

import { HISTORY_STORE } from '../../core/constants/injection-tokens.constants';
import { InMemoryHistoryStore } from '../../core/history/in-memory-history-store';

/**
 * Único lugar del proyecto que conoce InMemoryHistoryStore.
 *
 * El resto de módulos solo debe inyectar el token HISTORY_STORE y depender
 * del contrato HistoryStore, nunca de esta implementación concreta.
 */
@Module({
  providers: [
    {
      provide: HISTORY_STORE,
      useClass: InMemoryHistoryStore,
    },
  ],
  exports: [HISTORY_STORE],
})
export class HistoryModule {}
