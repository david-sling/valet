import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsPage } from '#/components/docs/DocsPage'
import { getDoc } from '#/lib/docs'
import { getStars } from '#/lib/github'
import { docHead } from './-head'

export const Route = createFileRoute('/docs/')({
  loader: async () => {
    if (!getDoc('')) throw notFound()
    return { stars: await getStars() }
  },
  head: () => docHead(getDoc('')),
  component: () => <DocsPage doc={getDoc('')!} stars={Route.useLoaderData().stars} />,
})
