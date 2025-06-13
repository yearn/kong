
export const camelToSnake = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)

export const snakeToCamel = (str: string) => str.replace(/(_\w)/g, matches => matches[1].toUpperCase())

export const removeLeadingSlash = (str: string) => str.startsWith('/') ? str.slice(1) : str

export const removeTrailingSlash = (str: string) => str.endsWith('/') ? str.slice(0, -1) : str

export const removeLeadingAndTrailingSlash = (str: string) => removeTrailingSlash(removeLeadingSlash(str))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const snakeToCamelCols = (rows: any[]) => {
  return rows.map(row => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: { [key: string]: any } = {}
    for (const key of Object.keys(row)) {
      result[snakeToCamel(key)] = row[key]
    }
    return result
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const snakeToCamelObject = (obj: { [key: string]: any }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: { [key: string]: any } = {}
  for (const key of Object.keys(obj)) {
    result[snakeToCamel(key)] = obj[key]
  }
  return result
}
