/**
 * Float utility class for handling arbitrary-precision decimal arithmetic operations.
 * This is a TypeScript implementation inspired by a Go bigNumber package,
 * using js-big-decimal for proper decimal support.
 */

import { BigNumber } from '@ethersproject/bignumber'
import { BigNumberInt } from './bignumber-int'
import BigDecimal from 'js-big-decimal'

/**
 * Float class provides enhanced functionality around BigDecimal:
 * - Method chaining for fluent API usage
 * - Simplified arithmetic operations
 * - Safe handling of null/undefined values
 * - Comparison helper methods for intuitive value checking
 */
export class Float {
  private value: BigDecimal

  /**
   * Creates a new Float initialized with the provided value.
   * If no value is provided, it initializes to zero.
   *
   * @param defaultValue Optional initial numeric value (defaults to 0 if omitted)
   * @returns A new Float initialized to the specified value
   */
  constructor(defaultValue?: number | string | BigNumber | BigDecimal) {
    if (defaultValue === undefined || defaultValue === null) {
      this.value = new BigDecimal('0')
    } else if (defaultValue instanceof BigDecimal) {
      this.value = defaultValue
    } else if (defaultValue instanceof BigNumber) {
      this.value = new BigDecimal(defaultValue.toString())
    } else if (typeof defaultValue === 'string') {
      // Handle empty strings
      if (defaultValue === '' || defaultValue === '""') {
        this.value = new BigDecimal('0')
      } else {
        try {
          this.value = new BigDecimal(defaultValue)
        } catch (e) {
          // If parsing fails, default to 0
          this.value = new BigDecimal('0')
        }
      }
    } else {
      try {
        // Convert number to string first to avoid precision issues
        this.value = new BigDecimal(defaultValue.toString())
      } catch (e) {
        this.value = new BigDecimal('0')
      }
    }
  }

  /**
   * Converts a Float back to a BigNumber.
   * This function provides a bridge to the ethers library when needed.
   *
   * @returns The underlying value as a BigNumber
   */
  toBigNumber(): BigNumber {
    // First check if the value has a decimal point
    const valueStr = this.value.getValue()
    if (valueStr.includes('.')) {
      // For ethers BigNumber, we need to remove the decimal point
      // This may cause precision loss as BigNumber is for integers
      const intValue = valueStr.replace('.', '')
      return BigNumber.from(intValue)
    }
    return BigNumber.from(valueStr)
  }

  /**
   * Creates a new Float from an existing Float, BigDecimal, BigNumber, number or string.
   *
   * @param value The value to create a new Float from
   * @returns A new Float initialized with the provided value
   */
  static from(value?: Float | BigDecimal | BigNumber | number | string): Float {
    if (value instanceof Float) {
      return new Float(value.value)
    }
    return new Float(value)
  }

  /**
   * Clones another Float's value into this instance.
   *
   * @param source The source Float to copy from
   * @returns This Float instance with the updated value (for method chaining)
   */
  clone(source: Float | null | undefined): Float {
    if (!source) return this
    this.value = source.value
    return this
  }

  /**
   * Sets the value from a BigDecimal.
   *
   * @param value The BigDecimal to copy the value from
   * @returns This Float with the updated value (for method chaining)
   */
  set(value: BigDecimal | BigNumber | null | undefined): Float {
    if (!value) return this
    if (value instanceof BigNumber) {
      this.value = new BigDecimal(value.toString())
    } else {
      this.value = value
    }
    return this
  }

  /**
   * Parses a string representation of a number and assigns it.
   *
   * @param value The string representation of a number
   * @returns This Float with the updated value (for method chaining)
   */
  setString(value: string): Float {
    if (value === '' || value === '""') {
      this.value = new BigDecimal('0')
      return this
    }

    try {
      this.value = new BigDecimal(value)
    } catch (e) {
      // If parsing fails, default to current value
    }
    return this
  }

  /**
   * Sets the value from a number.
   *
   * @param value The number to set
   * @returns This Float with the updated value (for method chaining)
   */
  setNumber(value: number): Float {
    this.value = new BigDecimal(value.toString())
    return this
  }

  /**
   * Sets the value from an integer.
   *
   * @param value The integer value to set
   * @returns This Float with the updated value (for method chaining)
   */
  setInt(value: BigNumberInt): Float {
    this.value = new BigDecimal(value.toString())
    return this
  }

  /**
   * Sets the value from an unsigned integer.
   *
   * @param value The unsigned integer value to set
   * @returns This Float with the updated value (for method chaining)
   */
  setUint64(value: number): Float {
    this.value = new BigDecimal(value.toString())
    return this
  }

  /**
   * Sets the Float value from a JavaScript number (float64).
   * Handles special cases like NaN, 0, and Infinity.
   *
   * @param x The JavaScript number to set
   * @returns This Float with the updated value (for method chaining)
   * @throws Error if x is NaN
   */
  setFloat64(x: number): Float {
    // Check for NaN
    if (isNaN(x)) {
      throw new Error('Float.setFloat64(NaN): Cannot set NaN value')
    }

    // For all other numbers (including zero, infinity, and normal numbers)
    this.value = new BigDecimal(x.toString())
    return this
  }

  /**
   * Adds two Float values and stores the result.
   *
   * @param x The first operand
   * @param y The second operand
   * @returns This Float with the result of x + y (for method chaining)
   */
  add(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')
    this.value = xValue.add(yValue)
    return this
  }

  /**
   * Subtracts one Float from another and stores the result.
   *
   * @param x The minuend (value to subtract from)
   * @param y The subtrahend (value to subtract)
   * @returns This Float with the result of x - y (for method chaining)
   */
  sub(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')
    this.value = xValue.subtract(yValue)
    return this
  }

  /**
   * Multiplies two Float values and stores the result.
   *
   * @param x The first operand
   * @param y The second operand
   * @returns This Float with the result of x * y (for method chaining)
   */
  mul(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')
    this.value = xValue.multiply(yValue)
    return this
  }

  /**
   * Divides one Float by another and stores the result.
   *
   * @param x The dividend (numerator)
   * @param y The divisor (denominator)
   * @returns This Float with the result of x / y, or zero if y is zero (for method chaining)
   */
  div(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')

    if (yValue.getValue() === '0') {
      this.value = new BigDecimal('0')
      return this
    }

    // Use a precision of 20 decimal places for division
    this.value = xValue.divide(yValue, 20)
    return this
  }

  /**
   * Alias for div method.
   */
  quo = this.div

  /**
   * Calculates x raised to the power of y and stores the result.
   *
   * @param x The base
   * @param y The exponent (unsigned integer)
   * @returns The result of x^y
   */
  static pow(x: Float, y: number): Float {
    if (y === 0) return new Float(1)

    const base = x.value
    let result = new BigDecimal('1')

    for (let i = 0; i < y; i++) {
      result = result.multiply(base)
    }

    return new Float(result)
  }

  /**
   * Calculates the current Float raised to the power of y.
   *
   * @param y The exponent (unsigned integer)
   * @returns A new Float with the result of this^y
   */
  pow(y: number): Float {
    if (y === 0) return new Float(1)

    let result = new BigDecimal('1')
    const base = this.value

    for (let i = 0; i < y; i++) {
      result = result.multiply(base)
    }

    return new Float(result)
  }

  /**
   * Converts the Float to its string representation.
   *
   * @returns The string representation of the Float value
   */
  toString(): string {
    return this.value.getValue()
  }

  /**
   * Checks if the Float value is equal to zero.
   *
   * @returns True if the value is zero, false otherwise
   */
  isZero(): boolean {
    return this.value.getValue() === '0'
  }

  /**
   * Checks if this Float is greater than another.
   *
   * @param x The value to compare against
   * @returns True if this value is greater than x, false otherwise
   */
  gt(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) > 0
  }

  /**
   * Checks if this Float is greater than or equal to another.
   *
   * @param x The value to compare against
   * @returns True if this value is greater than or equal to x, false otherwise
   */
  gte(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) >= 0
  }

  /**
   * Checks if this Float is less than another.
   *
   * @param x The value to compare against
   * @returns True if this value is less than x, false otherwise
   */
  lt(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) < 0
  }

  /**
   * Checks if this Float is less than or equal to another.
   *
   * @param x The value to compare against
   * @returns True if this value is less than or equal to x, false otherwise
   */
  lte(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) <= 0
  }

  /**
   * Checks if this Float is equal to another.
   *
   * @param x The value to compare against
   * @returns True if this value is equal to x, false otherwise
   */
  eq(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) === 0
  }

  /**
   * Checks if this Float is not equal to another.
   *
   * @param x The value to compare against
   * @returns True if this value is not equal to x, false otherwise
   */
  neq(x: Float | null | undefined): boolean {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue) !== 0
  }

  /**
   * Alias for neq method. Checks if this Float is not equal to another.
   *
   * @param x The value to compare against
   * @returns True if this value is not equal to x, false otherwise
   */
  not(x: Float | null | undefined): boolean {
    return this.neq(x)
  }

  /**
   * Safely accesses a Float, returning a default value if null/undefined.
   *
   * @param value The Float to check for null/undefined
   * @param defaultValue Optional default value to return if value is null/undefined
   * @returns The original Float if not null/undefined, otherwise the default value
   */
  static safe(value: Float | null | undefined, defaultValue?: Float): Float {
    if (!value) {
      return defaultValue || new Float(0)
    }
    return value
  }

  /**
   * Safely accesses a Float, returning a default value if null/undefined.
   * Instance method version of the static safe method.
   *
   * @param value The Float to check for null/undefined
   * @param defaultValue Optional default value to return if value is null/undefined
   * @returns The original Float if not null/undefined, otherwise the default value
   */
  safe(value: Float | null | undefined, defaultValue?: Float): Float {
    if (!value) {
      return defaultValue || new Float(0)
    }
    return value
  }

  /**
   * Converts the Float to a JSON-serializable format.
   *
   * @returns The value as a string for JSON serialization
   */
  toJSON(): string {
    return this.value.getValue()
  }

  /**
   * Converts the Float to a number (with potential loss of precision).
   * This is useful for interoperability with JavaScript APIs.
   *
   * @returns The Float value as a JavaScript number
   */
  toNumber(): number {
    try {
      return parseFloat(this.value.getValue())
    } catch (e) {
      // If parsing fails, return 0
      return 0
    }
  }

  /**
   * Converts the Float to an Int representation by truncating any fractional part.
   *
   * @returns A BigNumber representing the integer part of this Float
   */
  toInt(): BigNumber {
    // Get integer part by removing everything after the decimal point
    const intPart = this.value.getValue().split('.')[0] || '0'
    return BigNumber.from(intPart)
  }

  /**
   * Returns the absolute value of this Float.
   *
   * @returns A new Float with the absolute value
   */
  abs(): Float {
    return new Float(this.value.abs())
  }

  /**
   * Returns a new Float with the negated value.
   *
   * @returns A new Float with the negated value
   */
  neg(): Float {
    // Negate by multiplying by -1
    return new Float(this.value.multiply(new BigDecimal('-1')))
  }

  /**
   * Calculates the remainder of division of x by y.
   *
   * @param x The dividend
   * @param y The divisor
   * @returns This Float with the result of x % y (for method chaining)
   */
  mod(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')

    if (yValue.getValue() === '0') {
      this.value = new BigDecimal('0')
      return this
    }

    // Calculate x - (y * floor(x/y))
    const quotient = xValue.divide(yValue, 0) // Integer division
    const product = quotient.multiply(yValue)
    this.value = xValue.subtract(product)
    return this
  }

  /**
   * Checks if this Float is an integer (has no fractional part).
   *
   * @returns True if the value has no fractional part, false otherwise
   */
  isInt(): boolean {
    const valueStr = this.value.getValue()
    return !valueStr.includes('.') || valueStr.endsWith('.0')
  }

  /**
   * Checks if this Float is infinity.
   * js-big-decimal doesn't have a concept of infinity, so we return false.
   *
   * @returns Always false for the current implementation
   */
  isInf(): boolean {
    return false
  }

  /**
   * Formats the Float as a string with the specified number of decimal places.
   *
   * @param decimals The number of decimal places to display
   * @returns A string representation with the specified decimal places
   */
  format(decimals: number): string {
    if (decimals <= 0) return this.value.round(0).getValue()
    return this.value.round(decimals).getValue()
  }

  /**
   * Compares this Float with another and returns:
   * -1 if this < x
   *  0 if this == x
   *  1 if this > x
   *
   * @param x The Float to compare with
   * @returns Comparison result as -1, 0, or 1
   */
  cmp(x: Float | null | undefined): number {
    const xValue = x?.value || new BigDecimal('0')
    return this.value.compareTo(xValue)
  }

  /**
   * Checks if the value is negative.
   *
   * @returns True if the value is less than zero
   */
  isNegative(): boolean {
    return this.value.compareTo(new BigDecimal('0')) < 0
  }

  /**
   * Checks if the value is positive.
   *
   * @returns True if the value is greater than zero
   */
  isPositive(): boolean {
    return this.value.compareTo(new BigDecimal('0')) > 0
  }

  /**
   * Gets the sign of the Float value:
   * -1 if negative
   *  0 if zero
   *  1 if positive
   *
   * @returns The sign as -1, 0, or 1
   */
  sign(): number {
    const cmp = this.value.compareTo(new BigDecimal('0'))
    return cmp === 0 ? 0 : cmp < 0 ? -1 : 1
  }

  /**
   * Sets this Float to the minimum of two values.
   *
   * @param x The first value to compare
   * @param y The second value to compare
   * @returns This Float set to the minimum value (for method chaining)
   */
  min(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')

    this.value = xValue.compareTo(yValue) < 0 ? xValue : yValue
    return this
  }

  /**
   * Sets this Float to the maximum of two values.
   *
   * @param x The first value to compare
   * @param y The second value to compare
   * @returns This Float set to the maximum value (for method chaining)
   */
  max(x: Float | null | undefined, y: Float | null | undefined): Float {
    const xValue = x?.value || new BigDecimal('0')
    const yValue = y?.value || new BigDecimal('0')

    this.value = xValue.compareTo(yValue) > 0 ? xValue : yValue
    return this
  }

  /**
   * Converts this Float to a JavaScript number (float64).
   *
   * @returns A tuple containing the float64 value and an accuracy indicator
   * ('exact', 'below', or 'above')
   */
  toFloat64(): [number, string] {
    // Check for zero
    if (this.isZero()) {
      return [0, 'exact']
    }

    // Try to convert to a JavaScript number
    const num = parseFloat(this.value.getValue())

    // Check if we're within safe integer range
    if (Math.abs(num) <= Number.MAX_SAFE_INTEGER) {
      // Reconstruct the value and compare with original to check exactness
      const reconstructed = new Float(num)
      if (this.eq(reconstructed)) {
        return [num, 'exact']
      }

      // Determine if we're rounding up or down
      const diff = new Float(this.value.subtract(reconstructed.value))
      if (diff.isZero()) {
        return [num, 'exact']
      } else if (diff.isPositive()) {
        return [num, 'below']
      } else {
        return [num, 'above']
      }
    }

    // For values outside safe integer range,
    // the sign determines if the representation is above or below the actual value
    return [num, this.isNegative() ? 'above' : 'below']
  }
}
