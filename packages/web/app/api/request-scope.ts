import { getCloudflareContext } from '@opennextjs/cloudflare'

type CloudflareEnv = { HYPERDRIVE?: { connectionString: string } }

function cloudflareContext() {
  try {
    return getCloudflareContext()
  } catch {
    return undefined
  }
}

export function cloudflareEnv(): CloudflareEnv | undefined {
  return cloudflareContext()?.env as CloudflareEnv | undefined
}

export function perRequest<T extends object>(create: () => T): () => T {
  const shared = create()
  const scoped = new WeakMap<object, T>()
  return () => {
    const ctx = cloudflareContext()?.ctx
    if (!ctx) return shared
    let value = scoped.get(ctx)
    if (!value) scoped.set(ctx, value = create())
    return value
  }
}

export function delegate<T extends object>(current: () => T): T {
  return new Proxy(current(), {
    get(_, key) {
      const target = current()
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
