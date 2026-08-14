import { StrategyChannelRegistry } from '../../../application/strategy/strategy-channel-registry';
import { toChannelVm } from './channel.mapper';

function buildRegistry(): StrategyChannelRegistry {
  return new StrategyChannelRegistry({ canExecute: () => true });
}

describe('toChannelVm', () => {
  it('maps the default state of a channel: no strategy, inactive, no override', () => {
    const registry = buildRegistry();

    expect(toChannelVm('oficial', registry)).toEqual({
      channel: 'oficial',
      strategyId: null,
      active: false,
      maxMartingalesOverride: null,
    });
  });

  it('reflects an assigned strategy and an active channel', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('streak-3', 'oficial');
    registry.setActive('oficial', true);

    expect(toChannelVm('oficial', registry)).toEqual({
      channel: 'oficial',
      strategyId: 'streak-3',
      active: true,
      maxMartingalesOverride: null,
    });
  });

  it('reflects a maxMartingales override for the assigned strategy', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('streak-3', 'oficial');
    registry.setMaxMartingales('streak-3', 5);

    expect(toChannelVm('oficial', registry).maxMartingalesOverride).toBe(5);
  });

  it('reports maxMartingalesOverride as null when nothing is assigned to the channel', () => {
    const registry = buildRegistry();

    expect(toChannelVm('pruebas', registry).strategyId).toBeNull();
    expect(toChannelVm('pruebas', registry).maxMartingalesOverride).toBeNull();
  });
});
