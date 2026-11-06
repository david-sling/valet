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
import { getStars } from '#/lib/github'
import { getSkillUrl } from '#/lib/skill'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [stars, skill] = await Promise.all([getStars(), getSkillUrl()])
    return { stars, skill }
  },
  component: Home,
})

function Home() {
  const { stars, skill } = Route.useLoaderData()
  const mainRef = useRef<HTMLElement>(null)
  useStackedSections(mainRef)
  return (
    <>
      <Nav stars={stars} />
      <main ref={mainRef}>
        <TearHero skill={skill} />
        <AsksFirst />
        <ClientsSay />
        <ForVendors />
        <SandboxEnforces />
        <NotRemoteDesktop />
        <StubEnds stars={stars} skill={skill} />
      </main>
    </>
  )
}
