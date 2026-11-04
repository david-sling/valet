import { useEffect, type RefObject } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Each section after the hero holds still once its bottom reaches the bottom of the screen, and the next one slides
// up over it, as the dark section already does over the hero. Pinned by transform rather than position: fixed,
// because the dark section keeps its own sticky stage inside, which would lose its place in a fixed box.
export function useStackedSections(mainRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    gsap.registerPlugin(ScrollTrigger)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const sections = Array.from(main.querySelectorAll<HTMLElement>(':scope > section'))
      sections.slice(0, -1).forEach((section, i) => {
        ScrollTrigger.create({
          trigger: section,
          start: 'bottom bottom',
          endTrigger: sections[i + 1],
          end: 'top top',
          pin: true,
          pinSpacing: false,
          pinType: 'transform',
        })
      })
      ScrollTrigger.refresh()
      // the web fonts change every section's height, so measure again once they have arrived
      document.fonts?.ready.then(() => ScrollTrigger.refresh())
    })

    return () => mm.revert()
  }, [mainRef])
}
