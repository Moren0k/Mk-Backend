import { StrategyCatalogReadModel } from '../../../application/read-models/strategy-catalog.read-model';
import { StrategiesController } from './strategies.controller';

function buildReadModel(): jest.Mocked<StrategyCatalogReadModel> {
  return {
    list: jest.fn().mockReturnValue([
      { id: 'streak-3', name: 'Streak3Strategy', description: 'Racha de 3.' },
      { id: 'streak-4', name: 'Streak4Strategy', description: 'Racha de 4.' },
    ]),
  } as unknown as jest.Mocked<StrategyCatalogReadModel>;
}

describe('StrategiesController', () => {
  it('returns the catalog mapped to StrategyVm[]', () => {
    const readModel = buildReadModel();
    const controller = new StrategiesController(readModel);

    expect(controller.getStrategies()).toEqual([
      { id: 'streak-3', name: 'Streak3Strategy', description: 'Racha de 3.' },
      { id: 'streak-4', name: 'Streak4Strategy', description: 'Racha de 4.' },
    ]);
  });
});
