import { createTemporalState, TemporalStateError } from '@lp-labs/temporal-state';
const state = createTemporalState();
state.delete('x', 2);
const result: Readonly<Record<string, null | boolean | number | string | object>> =
  state.snapshotAt(2);
const error = new TemporalStateError('pruned', 'old');
void [result, error];
