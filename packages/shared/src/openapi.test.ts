import { describe, expect, it } from 'vitest';
import { fromOpenApi } from './openapi';

const spec = {
  openapi: '3.0.3',
  info: { title: 'Pet Store' },
  servers: [{ url: 'https://{host}/v1', variables: { host: { default: 'api.petstore.io' } } }],
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        tags: ['Pets'],
        summary: 'Fetch a pet',
        parameters: [
          { name: 'id', in: 'path', required: true },
          { name: 'expand', in: 'query', required: true },
          { name: 'X-Trace', in: 'header' },
        ],
      },
    },
    '/pets': {
      post: {
        operationId: 'createPet',
        tags: ['Pets'],
        requestBody: {
          content: { 'application/json': { example: { name: 'Rex' } } },
        },
      },
    },
  },
};

describe('fromOpenApi', () => {
  it('creates one request per operation, grouped by tag', () => {
    const col = fromOpenApi(spec);
    expect(col.name).toBe('Pet Store');
    expect(col.requests.map((r) => r.name).sort()).toEqual(['createPet', 'getPet']);
    expect(col.requests.every((r) => r.folderPath[0] === 'Pets')).toBe(true);
  });

  it('maps the server to a BASE_URL env var and prefixes paths', () => {
    const col = fromOpenApi(spec);
    expect(col.environments[0]).toEqual({ name: 'Default', vars: { BASE_URL: 'https://api.petstore.io/v1' } });
    const getPet = col.requests.find((r) => r.name === 'getPet')!;
    expect(getPet.request.url).toBe("${ env('BASE_URL') }/pets/${ id }?expand=${ expand }");
  });

  it('maps header params and the operation summary', () => {
    const getPet = fromOpenApi(spec).requests.find((r) => r.name === 'getPet')!;
    expect(getPet.request.headers).toEqual({ 'X-Trace': '${ X-Trace }' });
    expect(getPet.request.info).toBe('Fetch a pet');
  });

  it('maps a JSON requestBody example to the body', () => {
    const createPet = fromOpenApi(spec).requests.find((r) => r.name === 'createPet')!;
    expect(createPet.request.method).toBe('POST');
    expect(createPet.request.bodyType).toBe('json');
    expect(JSON.parse(createPet.request.body!)).toEqual({ name: 'Rex' });
  });

  it('maps http-bearer security to bearer auth with a secret reference', () => {
    const getPet = fromOpenApi(spec).requests.find((r) => r.name === 'getPet')!;
    expect(getPet.request.auth).toEqual({ kind: 'bearer', token: "${ secret('BEARER_TOKEN') }" });
  });

  it('maps an apiKey scheme to apikey auth', () => {
    const col = fromOpenApi({
      ...spec,
      security: [{ apiKeyAuth: [] }],
      components: { securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    });
    expect(col.requests[0].request.auth).toEqual({
      kind: 'apikey',
      key: 'X-API-Key',
      value: "${ secret('API_KEY') }",
      placement: 'header',
    });
  });

  it('is tolerant of a malformed spec', () => {
    expect(fromOpenApi(null)).toEqual({ name: 'Imported API', requests: [], environments: [] });
    expect(fromOpenApi({ paths: 'nope' }).requests).toEqual([]);
  });

  it('works without servers (no BASE_URL prefix)', () => {
    const col = fromOpenApi({ info: { title: 'X' }, paths: { '/a': { get: {} } } });
    expect(col.environments).toEqual([]);
    expect(col.requests[0].request.url).toBe('/a');
    expect(col.requests[0].name).toBe('GET /a');
  });
});
