export type CoachStage =
  | 'provider_request'
  | 'provider_output'
  | 'proposal_validation'
  | 'proposal_simulation';

const names = new Set([
  'Error',
  'TypeError',
  'AbortError',
  'TimeoutError',
  'ZodError',
  'AI_APICallError',
  'AI_NoObjectGeneratedError',
  'AI_TypeValidationError',
  'AI_RetryError',
]);
const codes = new Set([
  'invalid_json_schema',
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'model_not_found',
  'invalid_request_error',
  'context_length_exceeded',
  'server_error',
  'overloaded_error',
]);

export function coachDiagnostic(error: unknown, stage: CoachStage, diagnosticId: string) {
  const failure = error as { lastError?: unknown } | null;
  const upstream = (failure?.lastError || error || {}) as {
    name?: unknown;
    statusCode?: number;
    data?: { error?: { code?: unknown } };
  };
  const code = upstream.data?.error?.code;
  return {
    diagnosticId,
    stage,
    name: typeof upstream.name === 'string' && names.has(upstream.name) ? upstream.name : 'Error',
    status:
      Number.isInteger(upstream.statusCode) &&
      upstream.statusCode! >= 100 &&
      upstream.statusCode! <= 599
        ? upstream.statusCode
        : undefined,
    code: typeof code === 'string' && codes.has(code) ? code : undefined,
    schemaRejected: code === 'invalid_json_schema' || undefined,
  };
}
