import { metrics, type Counter } from '@opentelemetry/api'
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

const ENDPOINT = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT

let provider: MeterProvider | undefined
const counters = new Map<string, Counter>()

function meter() {
  if (!ENDPOINT) return null
  if (!provider) {
    const exporter = new OTLPMetricExporter({ temporalityPreference: AggregationTemporalityPreference.DELTA })
    provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 10_000 })] })
    metrics.setGlobalMeterProvider(provider)
  }
  return provider.getMeter('kong')
}

export function countMetric(name: string, value: number, attributes: Record<string, string>) {
  const m = meter()
  if (!m) return
  let counter = counters.get(name)
  if (!counter) counters.set(name, counter = m.createCounter(name))
  counter.add(value, attributes)
}

export async function flush() {
  await provider?.forceFlush()
}
