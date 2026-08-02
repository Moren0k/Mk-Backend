import { NoSignal } from './no-signal.type';
import { StrategySignal } from './strategy-signal.type';

/**
 * Lo que devuelve `Strategy.evaluate(...)`. El discriminante `triggered`
 * permite distinguir ambos casos con un simple `if`, sin `instanceof`.
 */
export type StrategyResult = StrategySignal | NoSignal;
