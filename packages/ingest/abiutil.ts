/* eslint-disable @typescript-eslint/no-explicit-any */

import _path from 'path'

export async function load(path: string) {
  const abipath = _path.join(__dirname, 'abis', `${path}/abi.ts`)
  const module = await import(abipath)
  return module.default
}

export function events(abi: any) {
  return abi.filter((x: any) => x.type === 'event')
}

export function exclude(names: string[], events: any) {
  return events.filter((x: any) => !names.includes(x.name))
}

export function fields(abi: any) {
  return abi.filter((x: any) => x.type === 'function' && (x.stateMutability === 'view' || x.stateMutability === 'pure') && x.inputs.length === 0)
}

export default { load, events, exclude, fields }
