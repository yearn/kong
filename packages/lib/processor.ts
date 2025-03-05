export interface Processor {
  up(): Promise<void>
  down(): Promise<void>
}

export class ProcessorPool<T extends Processor> implements Processor {
  private pool: T[] = []
  private pointer = 0
  private interval: NodeJS.Timer | undefined

  constructor(private readonly Type: new () => T, size: number = 2, private recycleMs: number) {
    for (let i = 0; i < size; i++) {
      this.pool.push(new Type())
    }
  }

  private startRecycling() {
    if (this.pool.length < 2) return
    this.interval = setInterval(async () => {
      console.log('♻️ ', this.Type.name, this.pointer)
      await this.pool[this.pointer].down?.()
      this.pool[this.pointer] = new this.Type()
      await this.pool[this.pointer].up()
      this.pointer = (this.pointer + 1) % this.pool.length
    }, this.recycleMs / this.pool.length)
  }

  async up() {
    await Promise.all(this.pool.map(p => p.up()))
    this.startRecycling()
  }

  async down() {
    clearInterval(this.interval)
    await Promise.all(this.pool.map(p => p.down?.()))
  }

  get(index: number) {
    return this.pool[index]
  }
}
