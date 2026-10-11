export const boardHue = (seed: number) => (Math.max(0, seed) * 137.508) % 360
export const boardColor = (seed: number) => `hsl(${boardHue(seed).toFixed(3)} 42% 54%)`
