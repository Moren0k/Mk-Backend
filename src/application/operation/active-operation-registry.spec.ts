import { WinnerType } from '../../core/enums/winner-type.enum';
import { Operation } from '../../core/operation/operation.entity';
import { StrategyTrigger } from '../../core/strategy/types/strategy-signal.type';
import { ActiveOperationRegistry } from './active-operation-registry';

function buildSignal(
  overrides: Partial<StrategyTrigger> = {},
): StrategyTrigger {
  return {
    triggered: true,
    strategyId: 'streak-3',
    context: 'oficial',
    strategyName: 'Streak3Strategy',
    triggeredAt: new Date('2026-08-01T00:00:00.000Z'),
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    maxMartingales: 2,
    triggerGameUuid: 'trigger-game',
    reason: 'test',
    metadata: {},
    ...overrides,
  };
}

describe('ActiveOperationRegistry', () => {
  let registry: ActiveOperationRegistry;

  beforeEach(() => {
    registry = new ActiveOperationRegistry();
  });

  it('allows execution for a strategy with no active operations', () => {
    expect(registry.canExecute('streak-3')).toBe(true);
  });

  it('denies execution for a strategy once it has a registered operation', () => {
    const operation = Operation.open(buildSignal({ strategyId: 'streak-3' }));

    registry.register(operation);

    expect(registry.canExecute('streak-3')).toBe(false);
  });

  it('does not affect other strategies', () => {
    const operation = Operation.open(buildSignal({ strategyId: 'streak-3' }));

    registry.register(operation);

    expect(registry.canExecute('other-strategy')).toBe(true);
  });

  it('allows execution again once the operation is unregistered', () => {
    const operation = Operation.open(buildSignal({ strategyId: 'streak-3' }));
    registry.register(operation);

    registry.unregister(operation.operationId);

    expect(registry.canExecute('streak-3')).toBe(true);
  });

  it('ignores unregistering an unknown operationId', () => {
    expect(() => registry.unregister('does-not-exist')).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it('keeps a strategy blocked while it still has other active operations', () => {
    const first = Operation.open(buildSignal({ strategyId: 'streak-3' }));
    const second = Operation.open(buildSignal({ strategyId: 'streak-3' }));
    registry.register(first);
    registry.register(second);

    registry.unregister(first.operationId);

    expect(registry.canExecute('streak-3')).toBe(false);
    expect(registry.size()).toBe(1);
  });

  it('getAll returns every registered operation regardless of strategy', () => {
    const a = Operation.open(buildSignal({ strategyId: 'a' }));
    const b = Operation.open(buildSignal({ strategyId: 'b' }));
    registry.register(a);
    registry.register(b);

    expect(registry.getAll()).toEqual(expect.arrayContaining([a, b]));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('getById finds a registered operation by its operationId', () => {
    const operation = Operation.open(buildSignal({ strategyId: 'streak-3' }));
    registry.register(operation);

    expect(registry.getById(operation.operationId)).toBe(operation);
  });

  it('getById returns undefined for an unknown or unregistered operationId', () => {
    expect(registry.getById('does-not-exist')).toBeUndefined();
  });

  it('size reflects the number of registered operations', () => {
    registry.register(Operation.open(buildSignal({ strategyId: 'a' })));
    registry.register(Operation.open(buildSignal({ strategyId: 'b' })));

    expect(registry.size()).toBe(2);
  });
});
