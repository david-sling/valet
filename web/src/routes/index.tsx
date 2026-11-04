import { createFileRoute } from '@tanstack/react-router'
import { Nav } from '#/components/Nav'
import { TearHero, type EmojiSet } from '#/components/hero/TearHero'

export const Route = createFileRoute('/')({
  // ?set=fluent swaps the hands to Microsoft's Fluent 3D emoji
  validateSearch: (search: Record<string, unknown>): { set?: EmojiSet } =>
    search.set === 'fluent' ? { set: 'fluent' } : {},
  component: Home,
})

function Home() {
  const { set } = Route.useSearch()
  return (
    <>
      <Nav />
      <main>
        <TearHero set={set} />
        <section className="after" id="how">
          <div className="after-inner">
            <h2 className="h2">Every command asks first.</h2>
            <p>The rest of the page continues here. This section slides up over the pinned scene.</p>
          </div>
        </section>
      </main>
    </>
  )
}
