import type { StrategyDescriptor } from '../../../application/read-models/strategy-catalog.read-model';
import { toStrategyVm } from './strategy.mapper';

describe('toStrategyVm', () => {
  it('maps a strategy descriptor 1:1', () => {
    const descriptor: StrategyDescriptor = {
      id: 'streak-4',
      name: 'Streak4Strategy',
      description: 'Racha de 4 resultados consecutivos.',
    };

    expect(toStrategyVm(descriptor)).toEqual(descriptor);
  });
});
