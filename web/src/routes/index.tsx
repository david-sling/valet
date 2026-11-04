import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Nav } from '#/components/Nav'
import { TearHero } from '#/components/hero/TearHero'
import { AsksFirst } from '#/components/asks/AsksFirst'
import { ClientsSay } from '#/components/clients/ClientsSay'
import { ForVendors } from '#/components/vendors/ForVendors'
import { SandboxEnforces } from '#/components/security/SandboxEnforces'
import { NotRemoteDesktop } from '#/components/compare/NotRemoteDesktop'
import { StubEnds } from '#/components/closing/StubEnds'
import { useStackedSections } from '#/lib/stack-sections'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const mainRef = useRef<HTMLElement>(null)
  useStackedSections(mainRef)
  return (
    <>
      <Nav />
      <main ref={mainRef}>
        <TearHero />
        <AsksFirst />
        <ClientsSay />
        <ForVendors />
        <SandboxEnforces />
        <NotRemoteDesktop />
        <StubEnds />
      </main>
    </>
  )
}
