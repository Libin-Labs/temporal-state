# @lp-labs/temporal-state

Keep bounded, append-only JSON events per key and query the latest value at any retained timestamp.
Explicit compaction advances a history watermark while preserving a baseline value at the cutoff.

- Zero runtime and peer dependencies; ESM, CommonJS, and TypeScript declarations.
- Per-key timestamps are nondecreasing; same-time events use append order.
- In-memory only; no clock, persistence, distributed ordering, or automatic retention timer.
- [MIT](./LICENSE). Node.js 18+.

## Installation

```sh
npm install @lp-labs/temporal-state
```

## Quickstart

```js
import { createTemporalState } from '@lp-labs/temporal-state';

const state = createTemporalState({ maxEvents: 1000, maxKeys: 100 });
state.set('cart/42', 1_800_000_000_000, { items: 2 });
state.set('cart/42', 1_800_000_000_500, { items: 3 });
console.log(state.getAt('cart/42', 1_800_000_000_200)); // { items: 2 }
console.log(state.snapshotAt(1_800_000_000_500)); // { 'cart/42': { items: 3 } }
```

CommonJS: `const { createTemporalState } = require('@lp-labs/temporal-state')`.

## API and retention

`createTemporalState({ maxEvents?, maxKeys?, maxDepth? })` defaults to 10,000 events, 1,000 keys,
and 64 nesting levels. `set(key, timestampMs, json)` and `delete(key, timestampMs)` append events.
Keys contain 1..256 characters and timestamps are non-negative safe integer milliseconds. Capacity
overflow throws `TemporalStateError` with code `capacity`; records are never silently dropped.
Appending an earlier event for an existing key throws `out-of-order`.

`getAt(key, timestampMs)` returns the cloned value or `undefined` if the key was not present.
`snapshotAt(timestampMs)` returns a frozen plain record excluding deleted/absent keys.
`compact(beforeMs)` removes superseded history through the cutoff and returns the number of events
removed. It preserves the state as of the cutoff (including deletion) as a baseline. Queries strictly
before the watermark and appends before it throw `pruned`; moving the watermark backward throws
`conflict`. `snapshot()` reports retained event/key counts, `oldestAvailableAt` and latest event time.

## Customization and limitations

Choose timestamp units consistently and persist/rebuild events in your application if needed. Values
are cloned JSON, not arbitrary objects. Storage is process-local and bounded; no automatic expiry,
global ordering across keys, clock-skew correction, event sourcing integration, or historical query
before compaction is provided. A caller must decide a safe retention cutoff.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
