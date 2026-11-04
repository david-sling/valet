import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

// Momentum scrolling (Lenis) driving GSAP ScrollTrigger. Call only when motion is allowed;
// returns a cleanup that stops Lenis and unhooks it from GSAP's ticker.
// Links to a section on the page glide there too, instead of jumping.
export function startSmoothScroll() {
  gsap.registerPlugin(ScrollTrigger)
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true })
  const tick = (t: number) => lenis.raf(t * 1000)
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  // A section's place is measured from the layout, never the screen: a section that has pinned keeps a transform
  // afterwards, so its on-screen position isn't where the page scrolls to reach it.
  const top = (el: HTMLElement) => {
    let y = 0
    for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) y += e.offsetTop
    return y
  }
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
    const target = link && document.getElementById(decodeURIComponent(link.hash.slice(1)))
    if (!target) return
    event.preventDefault()
    lenis.scrollTo(top(target), { duration: 1.4, easing: (t) => 1 - (1 - t) ** 4 })
    history.replaceState(null, '', link.hash)
  }
  document.addEventListener('click', onClick)

  return () => {
    document.removeEventListener('click', onClick)
    gsap.ticker.remove(tick)
    lenis.destroy()
  }
}
