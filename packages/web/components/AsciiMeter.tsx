import React, { useEffect, useMemo, useRef, useState } from 'react'

function TextOverlay({ children }: { children: string }) {
  return <div className="relative text-lg">
    <div className="invisible">{children}</div>
    <div className="absolute inset-0 z-0 text-black font-bold blur-sm">{children}</div>
    <div className="absolute inset-0 z-10 text-yellow-500 [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)]">{children}</div>
  </div>
}

export default function AsciiMeter(
  {
    current,
    current2,
    max,
    leftLabel = '',
    rightLabel = '',
    panels = 24,
    className = ''
  } : {
    current: number,
    current2?: number,
    max: number,
    leftLabel?: string,
    rightLabel?: string,
    panels?: number,
    className?: string
  }
) {
  const meterRef = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState<number>(16) // Default font size

  useEffect(() => {
    const resizeHandler = () => {
      if (meterRef.current) {
        const { width } = meterRef.current.getBoundingClientRect()
        const newFontSize = width / panels // Adjust font size based on container width and number of panels
        setFontSize(newFontSize + 1)
      }
    }

    resizeHandler() // Initial resize
    window.addEventListener('resize', resizeHandler) // Add resize event listener

    return () => window.removeEventListener('resize', resizeHandler) // Cleanup on unmount
  }, [panels])

  const hasTwo = current2 !== undefined
  const maxPanels = useMemo(() => Math.round((max / max) * panels), [max, panels])
  const filledPanels = useMemo(() => Math.round((current / max) * panels), [current, max, panels])
  const filledPanels2 = useMemo(() => hasTwo ? Math.round((current2 / max) * panels) : 0, [hasTwo, current2, max, panels])

  const title = useMemo(() => {
    return `${leftLabel} ${rightLabel}`
  }, [leftLabel, rightLabel])

  return <div ref={meterRef} title={title} className={`relative flex items-center ${className}`}>
    <div className={'absolute z-50 top-0 left-0  w-full h-full px-3 flex items-center justify-between'}
      style={{ fontSize: `${Math.floor(fontSize * .75)}px` }}>
      <TextOverlay>{leftLabel}</TextOverlay>
      <TextOverlay>{rightLabel}</TextOverlay>
    </div>
    <div className="relative" style={{ fontSize: `${fontSize}px` }}>
      <div className="text-emerald-950">
        {'░'.repeat(panels)}
      </div>
      <div className="absolute z-10 inset-0 text-yellow-600">
        {'▒'.repeat(Math.min(filledPanels2, maxPanels))}
      </div>
      <div className="absolute z-20 inset-0 text-yellow-300">
        {'▒'.repeat(Math.min(filledPanels, maxPanels))}
      </div>
    </div>
  </div>
}
