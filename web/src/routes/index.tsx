import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Nav } from '#/components/Nav'
import { TearHero, type EmojiSet } from '#/components/hero/TearHero'
import { AsksFirst } from '#/components/asks/AsksFirst'
import { ClientsSay } from '#/components/clients/ClientsSay'
import { ForVendors } from '#/components/vendors/ForVendors'
import { SandboxEnforces } from '#/components/security/SandboxEnforces'
import { useStackedSections } from '#/lib/stack-sections'

export const Route = createFileRoute('/')({
  // ?set=fluent swaps the hands to Microsoft's Fluent 3D emoji
  validateSearch: (search: Record<string, unknown>): { set?: EmojiSet } =>
    search.set === 'fluent' ? { set: 'fluent' } : {},
  component: Home,
})

function Home() {
  const { set } = Route.useSearch()
  const mainRef = useRef<HTMLElement>(null)
  useStackedSections(mainRef)
  return (
    <>
      <Nav />
      <main ref={mainRef}>
        <TearHero set={set} />
        <AsksFirst />
        <ClientsSay />
        <ForVendors />
        <SandboxEnforces />
      </main>
    </>
  )
}
