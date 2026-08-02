import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('rejects a non-positive capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(-1)).toThrow(RangeError);
  });

  it('starts empty', () => {
    const buffer = new RingBuffer<number>(3);

    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.isFull()).toBe(false);
    expect(buffer.size()).toBe(0);
    expect(buffer.capacity()).toBe(3);
    expect(buffer.getAll()).toEqual([]);
    expect(buffer.getLatest()).toBeUndefined();
    expect(buffer.get(0)).toBeUndefined();
  });

  it('stores items in insertion order while not full', () => {
    const buffer = new RingBuffer<number>(5);

    buffer.add(1);
    buffer.add(2);
    buffer.add(3);

    expect(buffer.isEmpty()).toBe(false);
    expect(buffer.isFull()).toBe(false);
    expect(buffer.size()).toBe(3);
    expect(buffer.getAll()).toEqual([1, 2, 3]);
    expect(buffer.getLatest()).toBe(3);
    expect(buffer.get(0)).toBe(1);
    expect(buffer.get(2)).toBe(3);
  });

  it('becomes full once capacity items are added', () => {
    const buffer = new RingBuffer<number>(3);

    buffer.add(1);
    buffer.add(2);
    buffer.add(3);

    expect(buffer.isFull()).toBe(true);
    expect(buffer.size()).toBe(3);
  });

  it('overwrites the oldest item on wrap-around, preserving logical order', () => {
    const buffer = new RingBuffer<number>(3);

    buffer.add(1);
    buffer.add(2);
    buffer.add(3);
    buffer.add(4); // overwrites 1

    expect(buffer.size()).toBe(3);
    expect(buffer.isFull()).toBe(true);
    expect(buffer.getAll()).toEqual([2, 3, 4]);
    expect(buffer.getLatest()).toBe(4);
    expect(buffer.get(0)).toBe(2);

    buffer.add(5); // overwrites 2
    buffer.add(6); // overwrites 3

    expect(buffer.getAll()).toEqual([4, 5, 6]);
    expect(buffer.getLatest()).toBe(6);
  });

  it('keeps wrapping correctly across many cycles', () => {
    const buffer = new RingBuffer<number>(4);

    for (let i = 1; i <= 10; i++) {
      buffer.add(i);
    }

    // Last 4 inserted values, oldest to newest.
    expect(buffer.getAll()).toEqual([7, 8, 9, 10]);
    expect(buffer.getLatest()).toBe(10);
  });

  it('returns undefined for out-of-range indexes', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.add(1);

    expect(buffer.get(-1)).toBeUndefined();
    expect(buffer.get(1)).toBeUndefined();
    expect(buffer.get(99)).toBeUndefined();
  });

  it('clear() empties the buffer and resets pointers', () => {
    const buffer = new RingBuffer<number>(3);

    buffer.add(1);
    buffer.add(2);
    buffer.add(3);
    buffer.add(4); // wrap once, head moved

    buffer.clear();

    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.size()).toBe(0);
    expect(buffer.getAll()).toEqual([]);

    buffer.add(100);
    expect(buffer.getAll()).toEqual([100]);
  });

  it('getAll() returns a frozen array that cannot be mutated', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.add(1);
    buffer.add(2);

    const snapshot = buffer.getAll() as number[];

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => snapshot.push(3)).toThrow(TypeError);
  });

  it('getAll() results are independent across calls (not a live view)', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.add(1);
    buffer.add(2);

    const first = buffer.getAll();
    buffer.add(3);
    buffer.add(4); // wraps and overwrites the physical slot behind `first`

    expect(first).toEqual([1, 2]);
  });

  it('works with non-primitive types', () => {
    type Point = { x: number; y: number };
    const buffer = new RingBuffer<Point>(2);

    buffer.add({ x: 1, y: 1 });
    buffer.add({ x: 2, y: 2 });
    buffer.add({ x: 3, y: 3 });

    expect(buffer.getAll()).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});
