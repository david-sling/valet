// Where an element sits on the page, from the layout rather than the screen. The stacked sections are sticky, and a
// held section reports where it is held, not where it sits in the page, so its place is taken from the flow instead:
// just after the element before it. Anything that has pinned with a transform is measured from its layout too.
export function pageTop(el: HTMLElement): number {
  let y = 0
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
    if (getComputedStyle(e).position === 'sticky') {
      const prev = e.previousElementSibling as HTMLElement | null
      const margin = parseFloat(getComputedStyle(e).marginTop) || 0
      const parent = e.parentElement
      if (prev) return y + pageTop(prev) + prev.offsetHeight + margin
      return y + (parent ? pageTop(parent) : 0) + margin
    }
    y += e.offsetTop
  }
  return y
}
