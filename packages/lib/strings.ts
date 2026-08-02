
export const camelToSnake = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)

export const snakeToCamel = (str: string) => str.replace(/(_\w)/g, matches => matches[1].toUpperCase())

export const startSlash = (str: string) => str.startsWith('/') ? str : `/${str}`

export const endSlash = (str: string) => str.endsWith('/') ? str : `${str}/`

export const cutStartSlash = (str: string) => str.startsWith('/') ? str.slice(1) : str

export const cutEndSlash = (str: string) => str.endsWith('/') ? str.slice(0, -1) : str

export const cutStartAndEndSlash = (str: string) => cutEndSlash(cutStartSlash(str))

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const snakeToCamelCols = (rows: any[]) => {
  return rows.map(row => {
    const result: { [key: string]: any } = {}
    for (const key of Object.keys(row)) {
      result[snakeToCamel(key)] = row[key]
    }
    return result
  })
}
