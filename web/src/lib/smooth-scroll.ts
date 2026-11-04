import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

// Momentum scrolling (Lenis) driving GSAP ScrollTrigger. Call only when motion is allowed;
// returns a cleanup that stops Lenis and unhooks it from GSAP's ticker.
export function startSmoothScroll() {
  gsap.registerPlugin(ScrollTrigger)
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true })
  const tick = (t: number) => lenis.raf(t * 1000)
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)
  return () => {
    gsap.ticker.remove(tick)
    lenis.destroy()
  }
}
