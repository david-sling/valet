import { DownloadButton, StarButton } from './Links'

export function Nav({ stars }: { stars: number | null }) {
  return (
    <nav className="nav" aria-label="Main">
      <a className="brand" href="/">
        <img src="/brand/valet-mark.svg" alt="" width="26" height="26" />
        Valet
      </a>
      <div className="nav-links">
        <a href="#how">How it works</a>
        <a href="#security">Security</a>
        <a href="#clients">For clients</a>
      </div>
      <div className="nav-end">
        <StarButton stars={stars} label="Star" className="nav-star" />
        <DownloadButton small />
      </div>
    </nav>
  )
}
