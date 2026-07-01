import type { HttpAuth, HttpRequestModel, HttpResponseDto } from '@swaft/shared';
import { AppError } from '../errors';
import type { SecretService } from '../secret/SecretService';
import type { SettingsService } from '../workspace/SettingsService';

type FetchFn = typeof fetch;
const MAX_REDIRECTS = 5;

/**
 * Structured HTTP client (never cURL). Enforces the workspace **allowed-domains** allow-list with an
 * anchored host match, re-validates the host on every redirect hop (SSRF hardening), and resolves
 * auth secrets from the OS keychain so the renderer only ever holds `secretRef`s. See
 * SWAFT_SECURITY_MODEL §9. (An **empty** allow-list blocks everything — domains must be allow-listed.)
 */
export class HttpService {
  constructor(
    private readonly deps: { fetchFn: FetchFn; secrets: SecretService; settings: SettingsService },
  ) {}

  async send(req: HttpRequestModel): Promise<HttpResponseDto> {
    const { allowedDomains } = await this.deps.settings.getSettings();
    let current = this.buildUrl(req.url, req.query);
    this.assertAllowed(current, allowedDomains);

    const headers = new Headers(req.headers ?? {});
    this.applyAuth(headers, req.auth);

    const start = Date.now();
    let redirects = 0;
    let res: Response;
    for (;;) {
      res = await this.deps.fetchFn(current.toString(), {
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
      this.assertAllowed(current, allowedDomains); // re-validate the redirect target
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

  private assertAllowed(url: URL, allowed: string[]): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AppError('DOMAIN_NOT_ALLOWED', 'policy', `Protocol not allowed: ${url.protocol}`);
    }
    const host = url.hostname.toLowerCase();
    const ok = allowed.some((d) => {
      const dom = d.trim().toLowerCase();
      return dom.length > 0 && (host === dom || host.endsWith(`.${dom}`));
    });
    if (!ok) {
      throw new AppError('DOMAIN_NOT_ALLOWED', 'policy', `Domain not allowed: ${host}`, { host });
    }
  }

  private applyAuth(headers: Headers, auth?: HttpAuth): void {
    if (!auth || auth.kind === 'none') return;
    const secret = auth.secretRef ? this.deps.secrets.get(auth.secretRef) : null;
    if (!secret) return;
    if (auth.kind === 'bearer') {
      headers.set('Authorization', `Bearer ${secret}`);
    } else if (auth.kind === 'basic') {
      const token = Buffer.from(`${auth.username ?? ''}:${secret}`).toString('base64');
      headers.set('Authorization', `Basic ${token}`);
    } else if (auth.kind === 'apikey') {
      headers.set(auth.headerName || 'X-API-Key', secret);
    }
  }
}
