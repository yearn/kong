import React, { ReactNode } from 'react'

export default function Panel({ className, children }: { className?: string, children: ReactNode }) {
  return <div className={`p-4 ${className}`}>
    {children}
  </div>
}
