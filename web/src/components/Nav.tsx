export function Nav() {
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
      <a className="btn btn-ink btn-sm" href="#access">
        Get early access
      </a>
    </nav>
  )
}
