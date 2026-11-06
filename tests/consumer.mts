import { createTemporalState, type TemporalSnapshot } from '@lp-labs/temporal-state';
const state = createTemporalState({ maxEvents: 100 });
state.set('x', 1, { enabled: true });
const value = state.getAt('x', 1);
const snapshot: TemporalSnapshot = state.snapshot();
void [value, snapshot];
