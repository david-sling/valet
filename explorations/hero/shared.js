// Momentum scrolling (Lenis) driving GSAP ScrollTrigger, shared by every variant.
// Under reduced motion there is no Lenis and no scrubbed scene: pages stay in their resting layout.
window.VALET_REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

window.valetScroll = function () {
  gsap.registerPlugin(ScrollTrigger);
  if (window.VALET_REDUCED) return null;
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
};
