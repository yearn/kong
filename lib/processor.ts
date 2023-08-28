export interface Processor {
  up(): Promise<void>
  down(): Promise<void>
}

export class ProcessorPool<T extends Processor> implements Processor {
  private pool: T[] = []
  private pointer = 0
  private interval: NodeJS.Timeout | undefined
  private recycle = 10 * 60 * 1000

  constructor(private readonly Type: new () => T, size: number) {
    for (let i = 0; i < size; i++) {
      this.pool.push(new Type())
    }
  }

  private startRecycling() {
    this.interval = setInterval(async () => {
      console.log('♻️ ', this.Type.name, this.pointer)
      await this.pool[this.pointer].down()
      this.pool[this.pointer] = new this.Type()
      await this.pool[this.pointer].up()
      this.pointer = (this.pointer + 1) % this.pool.length
    }, this.recycle / this.pool.length)
  }

  async up() {
    await Promise.all(this.pool.map(p => p.up()))
    if(this.pool.length < 2) return
    this.startRecycling()
  }

  async down() {
    if(this.interval) clearInterval(this.interval)
    await Promise.all(this.pool.map(p => p.down()))
  }
}