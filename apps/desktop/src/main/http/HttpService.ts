import type { FolderProxyDto, HttpAuth, HttpRequestModel, HttpResponseDto } from '@swaft/shared';
import { AppError } from '../errors';
import type { SecretService } from '../secret/SecretService';
import type { SettingsService } from '../workspace/SettingsService';

type FetchFn = typeof fetch;
const MAX_REDIRECTS = 5;

/**
 * Structured HTTP client (never cURL). Enforces the workspace **blocked-domains** block-list with an
 * anchored host match (empty list = everything allowed), re-validates the host on every redirect hop
 * (SSRF hardening), force-applies the workspace **enforced headers** over the request's own, and
 * resolves auth secrets from the OS keychain so the renderer only ever holds `secretRef`s. See
 * SWAFT_SECURITY_MODEL §9. A folder-propagated proxy routes the request through `proxyFetchFn`
 * (an Electron proxied session in production).
 */
export class HttpService {
  constructor(
    private readonly deps: {
      fetchFn: FetchFn;
      /** A fetch routed through the given proxy; required for requests carrying a folder proxy. */
      proxyFetchFn?: (proxy: FolderProxyDto) => FetchFn;
      secrets: SecretService;
      settings: SettingsService;
    },
  ) {}

  async send(
    req: HttpRequestModel,
    opts: { proxy?: FolderProxyDto | null } = {},
  ): Promise<HttpResponseDto> {
    const fetchFn = this.pickFetch(opts.proxy ?? null);
    const { blockedDomains, enforcedHeaders } = await this.deps.settings.getSettings();
    let current = this.buildUrl(req.url, req.query);
    this.assertNotBlocked(current, blockedDomains);

    const headers = new Headers(req.headers ?? {});
    this.applyAuth(headers, current, req.auth);
    // Enforced headers win over both the request's own headers and its auth.
    for (const [name, value] of Object.entries(enforcedHeaders)) headers.set(name, value);

    const start = Date.now();
    let redirects = 0;
    let res: Response;
    for (;;) {
      res = await fetchFn(current.toString(), {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.body ?? undefined),
        redirect: 'manual',
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (++redirects > MAX_REDIRECTS) {
        throw new AppError('TOO_MANY_REDIRECTS', 'execution', 'Too many redirects.');
      }
      current = new URL(location, current);
      this.assertNotBlocked(current, blockedDomains); // re-validate the redirect target
    }

    const body = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });
    return {
      status: res.status,
      statusText: res.statusText,
      headers: respHeaders,
      body,
      durationMs: Date.now() - start,
    };
  }

  /** The transport for this request: direct, or through the folder-propagated proxy. */
  private pickFetch(proxy: FolderProxyDto | null): FetchFn {
    if (!proxy) return this.deps.fetchFn;
    if (!this.deps.proxyFetchFn) {
      throw new AppError('PROXY_UNAVAILABLE', 'execution', 'Proxying is not available.');
    }
    return this.deps.proxyFetchFn(proxy);
  }

  private buildUrl(raw: string, query?: Record<string, string>): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError('INVALID_URL', 'validation', 'Invalid URL.');
    }
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);
    return url;
  }

  private assertNotBlocked(url: URL, blocked: string[]): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AppError('DOMAIN_NOT_ALLOWED', 'policy', `Protocol not allowed: ${url.protocol}`);
    }
    const host = url.hostname.toLowerCase();
    const hit = blocked.some((d) => {
      const dom = d.trim().toLowerCase();
      return dom.length > 0 && (host === dom || host.endsWith(`.${dom}`));
    });
    if (hit) {
      throw new AppError('DOMAIN_NOT_ALLOWED', 'policy', `Domain is blocked: ${host}`, { host });
    }
  }

  /**
   * Apply the request auth: plain fields (basic username/password, bearer token, API key in a header
   * or query param) with the legacy keychain `secretRef` as fallback for older saved requests.
   * `inherit` is resolved upstream (ApiRequestService) — reaching here unresolved means no auth.
   */
  private applyAuth(headers: Headers, url: URL, auth?: HttpAuth): void {
    if (!auth || auth.kind === 'none' || auth.kind === 'inherit') return;
    const secret = auth.secretRef ? this.deps.secrets.get(auth.secretRef) : null;
    if (auth.kind === 'bearer') {
      const token = auth.token ?? secret;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } else if (auth.kind === 'basic') {
      const password = auth.password ?? secret ?? '';
      if (auth.username || password) {
        const token = Buffer.from(`${auth.username ?? ''}:${password}`).toString('base64');
        headers.set('Authorization', `Basic ${token}`);
      }
    } else if (auth.kind === 'apikey') {
      const key = auth.key || auth.headerName || 'X-API-Key';
      const value = auth.value ?? secret;
      if (value == null) return;
      if (auth.placement === 'query') url.searchParams.set(key, value);
      else headers.set(key, value);
    }
  }
}
