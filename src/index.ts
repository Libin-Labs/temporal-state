export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface TemporalOptions {
  readonly maxEvents?: number;
  readonly maxKeys?: number;
  readonly maxDepth?: number;
}

export interface TemporalSnapshot {
  readonly events: number;
  readonly keys: number;
  readonly oldestAvailableAt: number;
  readonly latestAt?: number;
}

export class TemporalStateError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity' | 'out-of-order' | 'pruned' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'TemporalStateError';
  }
}

interface Event {
  readonly at: number;
  readonly deleted: boolean;
  readonly value?: Json;
}

function cloneJson(value: unknown, maxDepth: number, depth = 0): Json {
  if (depth > maxDepth) throw new TemporalStateError('capacity', 'Value exceeds maxDepth.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 100_000) throw new TemporalStateError('capacity', 'Array is too large.');
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
        throw new TemporalStateError('invalid', 'JSON arrays cannot have extra properties.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new TemporalStateError('invalid', 'JSON arrays must be dense data properties.');
    }
    const copy: Json[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new TemporalStateError('invalid', 'JSON arrays must be dense data properties.');
      copy.push(cloneJson(descriptor.value, maxDepth, depth + 1));
    }
    return copy;
  }
  if (
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const copy: { [key: string]: Json } = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string')
        throw new TemporalStateError('invalid', 'JSON records cannot contain symbol keys.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new TemporalStateError('invalid', 'Values must use enumerable data properties.');
      Object.defineProperty(copy, key, {
        value: cloneJson(descriptor.value, maxDepth, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  }
  throw new TemporalStateError('invalid', 'Values must be finite JSON data.');
}

function timestamp(at: number): number {
  if (!Number.isSafeInteger(at) || at < 0)
    throw new TemporalStateError('invalid', 'Timestamp must be a non-negative safe integer.');
  return at;
}

export function createTemporalState(options: TemporalOptions = {}) {
  const maxEvents = options.maxEvents ?? 10_000;
  const maxKeys = options.maxKeys ?? 1000;
  const maxDepth = options.maxDepth ?? 64;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1_000_000)
    throw new RangeError('maxEvents must be an integer from 1 through 1000000.');
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 100_000)
    throw new RangeError('maxKeys must be an integer from 1 through 100000.');
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 256)
    throw new RangeError('maxDepth must be an integer from 0 through 256.');
  const history = new Map<string, Event[]>();
  let eventCount = 0;
  let watermark = 0;
  let latestAt: number | undefined;

  const assertKey = (key: string) => {
    if (typeof key !== 'string' || key.length < 1 || key.length > 256)
      throw new TemporalStateError('invalid', 'Key must contain 1..256 characters.');
  };
  const append = (key: string, atInput: number, event: Omit<Event, 'at'>) => {
    assertKey(key);
    const at = timestamp(atInput);
    if (at < watermark)
      throw new TemporalStateError('pruned', 'Cannot append before the compaction watermark.');
    const events = history.get(key);
    if (events && at < events[events.length - 1]!.at)
      throw new TemporalStateError(
        'out-of-order',
        'Events for each key must be nondecreasing in time.',
      );
    if (!events && history.size >= maxKeys)
      throw new TemporalStateError('capacity', `Key capacity of ${maxKeys} is full.`);
    if (eventCount >= maxEvents)
      throw new TemporalStateError('capacity', `Event capacity of ${maxEvents} is full.`);
    const next = events ?? [];
    next.push(Object.freeze({ at, ...event }));
    history.set(key, next);
    eventCount++;
    latestAt = Math.max(latestAt ?? at, at);
  };

  const stateAt = (key: string, at: number): Json | undefined => {
    const events = history.get(key);
    if (!events) return undefined;
    let low = 0;
    let high = events.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (events[middle]!.at <= at) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (found < 0 || events[found]!.deleted) return undefined;
    return cloneJson(events[found]!.value, maxDepth);
  };

  return Object.freeze({
    set(key: string, at: number, value: unknown): void {
      append(key, at, { deleted: false, value: cloneJson(value, maxDepth) });
    },
    delete(key: string, at: number): void {
      append(key, at, { deleted: true });
    },
    getAt(key: string, atInput: number): Json | undefined {
      assertKey(key);
      const at = timestamp(atInput);
      if (at < watermark)
        throw new TemporalStateError('pruned', `History before ${watermark} was compacted.`);
      return stateAt(key, at);
    },
    snapshotAt(atInput: number): Readonly<Record<string, Json>> {
      const at = timestamp(atInput);
      if (at < watermark)
        throw new TemporalStateError('pruned', `History before ${watermark} was compacted.`);
      const result: Record<string, Json> = {};
      for (const key of history.keys()) {
        const value = stateAt(key, at);
        if (value !== undefined)
          Object.defineProperty(result, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
      }
      return Object.freeze(result);
    },
    compact(beforeInput: number): number {
      const before = timestamp(beforeInput);
      if (before < watermark)
        throw new TemporalStateError('conflict', 'Compaction watermark cannot move backward.');
      let removed = 0;
      for (const [key, events] of history) {
        let last = -1;
        while (last + 1 < events.length && events[last + 1]!.at <= before) last++;
        if (last > 0) {
          const baseline = events[last]!;
          const kept = [Object.freeze({ ...baseline, at: before }), ...events.slice(last + 1)];
          removed += events.length - kept.length;
          history.set(key, kept);
        } else if (last === 0 && events[0]!.at < before) {
          events[0] = Object.freeze({ ...events[0]!, at: before });
        }
      }
      eventCount -= removed;
      watermark = before;
      return removed;
    },
    snapshot(): TemporalSnapshot {
      return Object.freeze({
        events: eventCount,
        keys: history.size,
        oldestAvailableAt: watermark,
        ...(latestAt === undefined ? {} : { latestAt }),
      });
    },
  });
}
