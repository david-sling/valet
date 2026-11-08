import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsPage } from '#/components/docs/DocsPage'
import { getDoc } from '#/lib/docs'
import { getStars } from '#/lib/github'
import { docHead } from './-head'

export const Route = createFileRoute('/docs/$')({
  loader: async ({ params }) => {
    if (!getDoc(params._splat ?? '')) throw notFound()
    return { stars: await getStars() }
  },
  head: ({ params }) => docHead(getDoc(params._splat ?? '')),
  component: Page,
})

function Page() {
  const { _splat = '' } = Route.useParams()
  return <DocsPage doc={getDoc(_splat)!} stars={Route.useLoaderData().stars} />
}
