import { useEffect, type RefObject } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Each section after the hero holds still once its bottom reaches the bottom of the screen, and the next one slides
// up over it, as the dark section already does over the hero. The holding is CSS sticky positioning (see
// styles.css), which the browser does as it scrolls, so nothing lags behind a finger on a phone. Sticking by the
// bottom needs each section's height, which this keeps in --h as fonts load and the page resizes.
export function useStackedSections(mainRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const sections = Array.from(main.querySelectorAll<HTMLElement>(':scope > section'))
    const measure = new ResizeObserver((entries) => {
      for (const { target } of entries) (target as HTMLElement).style.setProperty('--h', `${(target as HTMLElement).offsetHeight}px`)
      ScrollTrigger.refresh()
    })
    sections.forEach((section) => measure.observe(section))
    return () => measure.disconnect()
  }, [mainRef])
}
