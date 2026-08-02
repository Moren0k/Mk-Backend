/**
 * Buffer circular de tamaño fijo, genérico e independiente de cualquier dominio.
 *
 * Insertar (add) es O(1): nunca desplaza elementos (Array.shift) ni recrea
 * el array interno. Cuando el buffer está lleno, la posición más antigua se
 * sobrescribe y el puntero de "más antiguo" avanza una posición.
 *
 * El orden lógico expuesto por get/getAll siempre va de más antiguo (0) a
 * más reciente (size() - 1), sin importar en qué posición física del array
 * interno se encuentre cada elemento.
 */
export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private readonly cap: number;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('RingBuffer capacity must be a positive integer.');
    }

    this.cap = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  add(item: T): void {
    if (this.isFull()) {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.cap;
      return;
    }

    const writeIndex = (this.head + this.count) % this.cap;
    this.items[writeIndex] = item;
    this.count += 1;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }

    return this.items[(this.head + index) % this.cap];
  }

  getLatest(): T | undefined {
    return this.get(this.count - 1);
  }

  getAll(): ReadonlyArray<T> {
    const result: T[] = new Array<T>(this.count);

    for (let i = 0; i < this.count; i++) {
      result[i] = this.items[(this.head + i) % this.cap] as T;
    }

    return Object.freeze(result);
  }

  size(): number {
    return this.count;
  }

  capacity(): number {
    return this.cap;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  isFull(): boolean {
    return this.count === this.cap;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
