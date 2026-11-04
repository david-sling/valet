import { ApiError, toErrorResponse } from '../http'

const ENDPOINTS = [
  'POST /api/v1/sessions',
  'GET /api/v1/sessions/{id}',
  'POST /api/v1/sessions/{id}/actions',
  'GET /api/v1/sessions/{id}/actions/{action_id}',
  'GET /api/v1/sessions/{id}/events',
  'POST /api/v1/sessions/{id}/end',
  'GET /api/v1/sessions/{id}/log',
  'POST /api/v1/join',
  'POST /api/v1/sessions/{id}/start',
  'POST /api/v1/sessions/{id}/decline',
  'POST /api/v1/sessions/{id}/extend',
  'GET /api/v1/sessions/{id}/inbox',
  'POST /api/v1/sessions/{id}/actions/{action_id}/result',
  'PUT /api/v1/sessions/{id}/grants',
  'PUT /api/v1/sessions/{id}/log',
]

export const missing = ({ request }: { request: Request }) =>
  toErrorResponse(
    new ApiError(404, 'not_found', `There is no endpoint at ${request.method} ${new URL(request.url).pathname}.`, `The endpoints are: ${ENDPOINTS.join('; ')}.`),
  )
