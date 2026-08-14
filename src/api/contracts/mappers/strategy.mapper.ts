import type { StrategyDescriptor } from '../../../application/read-models/strategy-catalog.read-model';
import type { StrategyVm } from '../view-models/strategy.vm';

export function toStrategyVm(descriptor: StrategyDescriptor): StrategyVm {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
  };
}
