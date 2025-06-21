import { BigNumber } from '@ethersproject/bignumber'
import { Float } from './bignumber-float'

type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue }
type JSONArray = Array<JSONValue>

export class BigNumberInt {
  private value: bigint

  constructor(value?: bigint | number | string) {
    if (value === undefined) {
      this.value = 0n
    } else if (typeof value === 'bigint') {
      this.value = value
    } else if (typeof value === 'number') {
      this.value = BigInt(value)
    } else if (typeof value === 'string') {
      this.value = value === '' ? 0n : BigInt(value)
    } else {
      this.value = 0n
    }
  }

  static from(value?: bigint | number | string): BigNumberInt {
    return new BigNumberInt(value)
  }

  clone(source?: BigNumberInt): BigNumberInt {
    if (!source) return this
    this.value = source.value
    return this
  }

  set(val: bigint | number | string): this {
    if (typeof val === 'bigint') this.value = val
    else if (typeof val === 'number') this.value = BigInt(val)
    else if (typeof val === 'string') this.value = val === '' ? 0n : BigInt(val)
    return this
  }

  setString(s: string): this {
    this.value = s === '' || s === '""' ? 0n : BigInt(s)
    return this
  }

  setUint64(s: number | bigint): this {
    this.value = typeof s === 'bigint' ? s : BigInt(s)
    return this
  }

  add(x: BigNumberInt, y?: BigNumberInt): this {
    if (y) {
      this.value = x.value + y.value
    } else {
      this.value = this.value + x.value
    }
    return this
  }

  sub(x: BigNumberInt, y?: BigNumberInt): this {
    if (y) {
      this.value = x.value - y.value
    } else {
      this.value = this.value - x.value
    }
    return this
  }

  mul(x: BigNumberInt, y?: BigNumberInt): this {
    if (y) {
      this.value = x.value * y.value
    } else {
      this.value = this.value * x.value
    }
    return this
  }

  div(x: BigNumberInt, y?: BigNumberInt): this {
    if (y) {
      if (y.value === 0n) {
        this.value = 0n
      } else {
        this.value = x.value / y.value
      }
    } else {
      if (x.value === 0n) {
        this.value = 0n
      } else {
        this.value = this.value / x.value
      }
    }
    return this
  }

  exp(x: BigNumberInt, y: BigNumberInt, z?: BigNumberInt): this {
    // Modular exponentiation: x^y mod |z|
    const base = x.value
    const exponent = y.value
    const modulus = z ? (z.value < 0n ? -z.value : z.value) : 0n

    // Special case: if modulus is 0 or undefined, return 1 for non-positive exponent
    if (modulus === 0n) {
      this.value = exponent <= 0n ? 1n : base ** exponent
      return this
    }

    let result = 1n
    let b = base % modulus
    let e = exponent
    while (e > 0) {
      if (e % 2n === 1n) result = (result * b) % modulus
      e = e / 2n
      b = (b * b) % modulus
    }
    this.value = result
    return this
  }

  toUint64(): number {
    return Number(this.value)
  }

  toString(): string {
    return this.value.toString()
  }

  isZero(): boolean {
    return this.value === 0n
  }

  gt(x: BigNumberInt): boolean {
    return this.value > x.value
  }

  gte(x: BigNumberInt): boolean {
    return this.value >= x.value
  }

  lt(x: BigNumberInt): boolean {
    return this.value < x.value
  }

  lte(x: BigNumberInt): boolean {
    return this.value <= x.value
  }

  eq(x: BigNumberInt): boolean {
    return this.value === x.value
  }

  not(x: BigNumberInt): boolean {
    return this.value !== x.value
  }

  // JSON serialization as string (for compatibility with JS/JSON)
  toJSON(): string {
    return this.toString()
  }

  // For CSV serialization
  toCSV(): string {
    return this.toString()
  }

  // Nil-safe static method
  static safe(s?: BigNumberInt, defaultValue?: BigNumberInt): BigNumberInt {
    if (!s) return defaultValue || new BigNumberInt(0n)
    return s
  }

}


export function toNormalizedAmount(amount: BigNumberInt, decimals: number){
  const exponential = BigNumber.from(10).pow(decimals)
  return new Float(0).quo(
    new Float().setInt(amount),
    new Float().setInt(new BigNumberInt(exponential.toString()))
  )

}
