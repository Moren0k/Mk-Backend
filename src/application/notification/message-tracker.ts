import { Injectable, Logger } from '@nestjs/common';

import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { MessageType } from '../../core/notification/types/message-type.enum';

type TrackedMessage = {
  readonly operationId: string;
  readonly channel: NotificationChannelType;
  readonly type: MessageType;
  readonly messageId: number;
};

const MAX_ENTRIES = 100;

/**
 * Almacena temporalmente los messageId de Telegram asociados a una
 * operación activa. Cuando la operación cierra, el NotificationCoordinator
 * recupera los mensajes intermedios (MG1, MG2, TIE) y los borra.
 *
 * Sin persistencia: todo en memoria. Si el proceso se reinicia, los
 * messageId se pierden y los mensajes viejos quedan en Telegram.
 */
@Injectable()
export class MessageTracker {
  private readonly logger = new Logger(MessageTracker.name);
  private readonly messages = new Map<string, TrackedMessage[]>();

  register(
    operationId: string,
    channel: NotificationChannelType,
    type: MessageType,
    messageId: number,
  ): void {
    if (this.messages.size >= MAX_ENTRIES) {
      const oldest = this.messages.keys().next().value as string;
      this.messages.delete(oldest);
      this.logger.warn(
        `MessageTracker alcanzó el límite de ${MAX_ENTRIES} operaciones; se eliminó la más antigua (${oldest}).`,
      );
    }

    const entry = this.messages.get(operationId) ?? [];
    entry.push({ operationId, channel, type, messageId });
    this.messages.set(operationId, entry);
  }

  getAndClear(operationId: string): readonly TrackedMessage[] {
    const messages = this.messages.get(operationId) ?? [];
    this.messages.delete(operationId);
    return messages;
  }

  size(): number {
    return this.messages.size;
  }
}
