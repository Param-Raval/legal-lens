/**
 * Typed error for a non-OK HTTP response from an AI provider. SERVER ONLY.
 *
 * Previously a failed call threw `new Error("OpenAI API error 401. Please try
 * again.")`, and api-guard tried to classify it by pattern-matching that string.
 * Everything that wasn't a rate limit or a missing-config message collapsed into
 * a generic 500 "Something went wrong… Please try again", which is actively
 * misleading for a 401: retrying an invalid API key never helps.
 *
 * Carrying the status (and the provider's own error code/message) as fields lets
 * the response layer say what actually happened and whether retrying is pointless.
 */

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider: 'openai' | 'ollama';
  /** Provider's machine-readable code, e.g. Azure's "401" or "DeploymentNotFound". */
  readonly providerCode?: string;
  /** Provider's human-readable message. Platform text only — never request content. */
  readonly providerMessage?: string;

  constructor(
    provider: 'openai' | 'ollama',
    status: number,
    providerCode?: string,
    providerMessage?: string
  ) {
    super(`${provider} API error ${status}`);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = status;
    this.providerCode = providerCode;
    this.providerMessage = providerMessage;
  }

  /**
   * True for statuses where the request will fail identically no matter how many
   * times it is retried, because the deployment or credentials are wrong.
   * These must never be presented to the user as "please try again".
   */
  get isConfigProblem(): boolean {
    return (
      this.status === 401 ||
      this.status === 403 ||
      this.status === 404 ||
      this.status === 400
    );
  }
}

/** Max characters kept from a provider error body. */
const MAX_PROVIDER_MESSAGE = 300;

/**
 * Pull a safe code/message pair out of a provider's error response.
 *
 * Only the `error.code` / `error.message` fields of a JSON body are read. Those
 * are provider-authored platform strings (e.g. Azure's "Access denied due to
 * invalid subscription key or wrong API endpoint"), which are exactly what the
 * operator needs and contain none of the request payload. The body is never
 * returned wholesale, and a non-JSON body is discarded rather than guessed at,
 * so an endpoint that echoes the request cannot leak document text.
 */
export async function readProviderError(
  response: Response
): Promise<{ code?: string; message?: string }> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return {};
  }
  if (!text) return {};

  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown };
      message?: unknown;
    };
    const err = parsed.error ?? parsed;
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined;
    const rawMessage = (err as { message?: unknown }).message;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage.slice(0, MAX_PROVIDER_MESSAGE)
        : undefined;
    return { code, message };
  } catch {
    // Not JSON — could be an HTML error page or a proxy response. Discard rather
    // than forward text of unknown provenance.
    return {};
  }
}
