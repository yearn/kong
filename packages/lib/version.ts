
export function clean(version: string | undefined) {
  if(!version) throw new Error ('!version')
  return version
    .replace(/[^0-9.]/g, '')
    .replace(/[^0-9]$/g, '')
}
