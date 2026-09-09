import { EvmAddress, EvmAddressSchema, zhexstring } from 'lib/types'
import { z } from 'zod'
import db from '../../../../../db'
import { rpcs } from '../../../../../rpcs'
import roleManagerFactoryAbi from '../../roleManagerFactory/abi'

const SnapshotSchema = z.object({
  name: z.string()
})

type Snapshot = z.infer<typeof SnapshotSchema>

const DefaultsSchema = z.object({
  roleManagerFactory: EvmAddressSchema.optional(),
  project: z.object({ id: zhexstring, name: z.string().optional() }),
  inceptBlock: z.bigint({ coerce: true }),
  inceptTime: z.bigint({ coerce: true })
})

type Defaults = z.infer<typeof DefaultsSchema>

export default async function process(chainId: number, address: EvmAddress, data: object) {
  const defaults = await fetchDefaults(chainId, address)
  // Legacy managers have no factory project to query. Their project metadata
  // comes from manuals.yaml so event discovery can run without a factory.
  if (!defaults.roleManagerFactory) {
    if (!defaults.project.name) throw new Error('Manual role manager project name missing')
    return { project: { ...defaults.project, roleManager: address } }
  }
  const snapshot = SnapshotSchema.parse(data)
  const projectName = parseProjectName(snapshot)
  const project = await extractProject(chainId, defaults)
  return { project: { id: defaults.project.id, name: projectName, ...project } }
}

export function parseProjectName(snapshot: Snapshot) {
  return snapshot.name.replace(' Role Manager', '')
}

async function fetchDefaults(chainId: number, address: EvmAddress) {
  const result = await db.query(
    'SELECT defaults FROM thing WHERE chain_id = $1 AND address = $2',
    [chainId, address]
  )
  if (!result.rows[0]) throw new Error(`Thing not found, ${chainId}:${address}`)
  return DefaultsSchema.parse(result.rows[0].defaults)
}

async function extractProject(chainId: number, defaults: Defaults) {
  if (!defaults.roleManagerFactory) return {}
  const [roleManager, registry, accountant, debtAllocator] = await rpcs.next(chainId).readContract({
    abi: roleManagerFactoryAbi, address: defaults.roleManagerFactory, functionName: 'projects',
    args: [defaults.project.id]
  })
  return { roleManager, registry, accountant, debtAllocator }
}
