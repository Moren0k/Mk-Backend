import { InMemoryStrategyRuntimeState } from './in-memory-strategy-runtime-state';

describe('InMemoryStrategyRuntimeState', () => {
  let state: InMemoryStrategyRuntimeState;

  beforeEach(() => {
    state = new InMemoryStrategyRuntimeState();
  });

  it('returns undefined for a strategyId with no stored value', () => {
    expect(state.get('streak-3')).toBeUndefined();
  });

  it('returns the last value stored for a strategyId', () => {
    state.set('streak-3', 'game-1');

    expect(state.get('streak-3')).toBe('game-1');
  });

  it('overwrites the previous value for the same strategyId', () => {
    state.set('streak-3', 'game-1');
    state.set('streak-3', 'game-2');

    expect(state.get('streak-3')).toBe('game-2');
  });

  it('keeps values isolated per strategyId', () => {
    state.set('streak-3', 'game-1');
    state.set('other-strategy', 'game-9');

    expect(state.get('streak-3')).toBe('game-1');
    expect(state.get('other-strategy')).toBe('game-9');
  });
});
