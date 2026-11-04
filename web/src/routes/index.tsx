import { createFileRoute } from '@tanstack/react-router'
import { Nav } from '#/components/Nav'
import { TearHero, type EmojiSet } from '#/components/hero/TearHero'
import { AsksFirst } from '#/components/asks/AsksFirst'

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
        <AsksFirst />
        <section className="after" id="clients">
          <div className="after-inner">
            <h2 className="h2">Why your customers will say yes.</h2>
            <p>The rest of the page continues here.</p>
          </div>
        </section>
      </main>
    </>
  )
}
