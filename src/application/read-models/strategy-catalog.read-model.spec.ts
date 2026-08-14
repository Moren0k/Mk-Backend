import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { StrategyCatalogReadModel } from './strategy-catalog.read-model';

function buildStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 'streak-4',
    name: 'Streak4Strategy',
    description: 'Racha de 4 resultados consecutivos.',
    enabled: () => true,
    evaluate: jest.fn(),
    ...overrides,
  };
}

describe('StrategyCatalogReadModel', () => {
  it('projects every registered strategy to its id/name/description', () => {
    const readModel = new StrategyCatalogReadModel([
      buildStrategy({ id: 'streak-3', name: 'Streak3Strategy' }),
      buildStrategy({ id: 'streak-4', name: 'Streak4Strategy' }),
    ]);

    expect(readModel.list()).toEqual([
      {
        id: 'streak-3',
        name: 'Streak3Strategy',
        description: 'Racha de 4 resultados consecutivos.',
      },
      {
        id: 'streak-4',
        name: 'Streak4Strategy',
        description: 'Racha de 4 resultados consecutivos.',
      },
    ]);
  });

  it('never leaks enabled() or evaluate() — only the three public descriptor fields', () => {
    const readModel = new StrategyCatalogReadModel([buildStrategy()]);

    const [descriptor] = readModel.list();

    expect(descriptor).not.toHaveProperty('enabled');
    expect(descriptor).not.toHaveProperty('evaluate');
  });

  it('returns an empty list when no strategy is registered', () => {
    const readModel = new StrategyCatalogReadModel([]);

    expect(readModel.list()).toEqual([]);
  });
});
