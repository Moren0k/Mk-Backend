import type { StrategyChannelRegistry } from '../../../application/strategy/strategy-channel-registry';
import type { StrategyGroup } from '../../../core/strategy/strategy-group';
import type { ChannelVm } from '../view-models/channel.vm';

export function toChannelVm(
  channel: StrategyGroup,
  registry: StrategyChannelRegistry,
): ChannelVm {
  const strategyId = registry.getStrategyIdForChannel(channel) ?? null;

  return {
    channel,
    strategyId,
    active: registry.isActive(channel),
    maxMartingalesOverride: strategyId
      ? (registry.getMaxMartingalesOverride(strategyId) ?? null)
      : null,
  };
}
