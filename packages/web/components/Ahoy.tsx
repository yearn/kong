'use client'

import React from 'react'
import Image from 'next/image'

const workmark = ` _     _  _____  __   _  ______
 |____/  |     | | \\  | |  ____
 |    \\_ |_____| |  \\_| |_____|`

export default function Ahoy() {

  return <div className="relative w-full flex items-start gap-0">
    <div className="z-10 w-full flex flex-col items-start gap-2">
      <div className="sm:-mb-6 flex items-center gap-0 sm:gap-6">
        <div className="text-lg whitespace-pre [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)] z-10">{workmark}</div>
        <div className="hidden sm:block w-[128px] h-[128px] ml-[-32px] sm:ml-0 z-0">
          <Image src="/figure.png" alt="Kong" width={128} height={128} className="" />
        </div>
      </div>
      <p className="z-10 [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)] text-sm">Real-time/historical EVM indexer x Analytics</p>
      <div className="flex items-center gap-3 text-xs">
        <a href="/api/gql" target="_blank" className="z-10 [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)]">explorer</a>
        {'//'} <a href="https://status.yearn.fi" target="_blank" className="z-10 [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)]" rel="noreferrer">uptime</a>
        {'//'} <a href="https://github.com/yearn/kong" target="_blank" className="z-10 [text-shadow:_0_0_4px_rgb(0_0_0_/_100%)]" rel="noreferrer">github</a>
      </div>
    </div>
  </div>
}
