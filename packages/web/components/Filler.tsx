'use client'

import React, { useState, useEffect, useRef } from 'react'

interface FillerProps {
  character?: string
  className?: string
}

const Filler = ({
  character = '.',
  className = 'w-full h-24'
}: FillerProps) => {
  const [text, setText] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window) return

    const updateText = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current
        const charWidth = 8 // Approximate width of a character in pixels
        const charHeight = 16 // Approximate height of a character in pixels
        const cols = Math.floor(clientWidth / charWidth)
        const rows = Math.floor(clientHeight / charHeight) + 1
        const newText = (character.repeat(cols) + '\n').repeat(rows)
        setText(newText)
      }
    }

    updateText()
    window.addEventListener('resize', updateText)
    return () => window.removeEventListener('resize', updateText)
  }, [character])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden font-mono whitespace-pre text-base leading-none ${className}`}>
      {text}
    </div>
  )
}

export default Filler
