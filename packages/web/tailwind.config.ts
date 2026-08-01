import type { Config } from 'tailwindcss'

function heightSafeList() {
  const maxheight = 101
  return Array(maxheight).fill(0).map((_, index) => `h-[${index}%]`)
}

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    ...heightSafeList()
  ],
  theme: {
    extend: {
    },
  },
  plugins: [
    require('tailwind-scrollbar')
  ],
}
export default config
