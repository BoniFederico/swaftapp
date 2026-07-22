import { describe, expect, it } from 'vitest';
import { fromPostman, postmanToSeebo, seeboToPostman, toPostman } from './postman';
import type { ImportedRequest } from './collection';

describe('variable translation', () => {
  it('postman {{var}} <-> seebo ${ var }', () => {
    expect(postmanToSeebo('https://{{base}}/x/{{id}}')).toBe('https://${ base }/x/${ id }');
    expect(seeboToPostman("https://${ env('base') }/x/${ id }")).toBe('https://{{base}}/x/{{id}}');
  });

  it('export leaves richer formulas verbatim', () => {
    expect(seeboToPostman("${ a == 'x' ? 'y' : 'z' }")).toBe("${ a == 'x' ? 'y' : 'z' }");
  });
});

describe('fromPostman', () => {
  const collection = {
    info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'base', value: 'https://api.shop.io' }],
    item: [
      {
        name: 'Orders',
        item: [
          {
            name: 'Create order',
            request: {
              method: 'POST',
              header: [
                { key: 'Content-Type', value: 'application/json' },
                { key: 'X-Debug', value: '1', disabled: true },
              ],
              url: { raw: 'https://{{base}}/orders' },
              body: { mode: 'raw', raw: '{"id":1}', options: { raw: { language: 'json' } } },
              auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}' }] },
            },
          },
        ],
      },
    ],
  };

  it('flattens folders into folderPath and imports the request', () => {
    const col = fromPostman(collection);
    expect(col.name).toBe('Shop');
    expect(col.requests).toHaveLength(1);
    const r = col.requests[0];
    expect(r.folderPath).toEqual(['Orders']);
    expect(r.name).toBe('Create order');
    expect(r.request.method).toBe('POST');
    expect(r.request.url).toBe('https://${ base }/orders');
    expect(r.request.headers).toEqual({ 'Content-Type': 'application/json' }); // disabled dropped
    expect(r.request.body).toBe('{"id":1}');
    expect(r.request.bodyType).toBe('json');
    expect(r.request.auth).toEqual({ kind: 'bearer', token: '${ TOKEN }' });
  });

  it('imports collection variables as an environment', () => {
    expect(fromPostman(collection).environments).toEqual([
      { name: 'Shop', vars: { base: 'https://api.shop.io' } },
    ]);
  });

  it('imports a urlencoded body as form', () => {
    const col = fromPostman({
      item: [
        {
          name: 'f',
          request: {
            method: 'POST',
            url: 'https://x',
            body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }] },
          },
        },
      ],
    });
    expect(col.requests[0].request.body).toBe('a=1&b=2');
    expect(col.requests[0].request.bodyType).toBe('form');
  });

  it('is tolerant of junk', () => {
    expect(fromPostman(null).requests).toEqual([]);
    expect(fromPostman({ item: 'nope' }).requests).toEqual([]);
  });
});

describe('toPostman', () => {
  const requests: ImportedRequest[] = [
    {
      name: 'Create order',
      folderPath: ['Orders'],
      request: {
        method: 'POST',
        url: "https://${ env('base') }/orders",
        headers: { Accept: 'application/json' },
        body: '{"id":1}',
        bodyType: 'json',
        auth: { kind: 'bearer', token: "${ secret('TOKEN') }" },
      },
    },
  ];

  it('builds a v2.1 collection with nested folders, serializing Seebo verbatim', () => {
    const pm = toPostman({ name: 'Shop', requests });
    // Navigate the plain-object result without `any`.
    const get = (o: unknown, k: string): unknown => (o as Record<string, unknown>)[k];
    const info = get(pm, 'info') as Record<string, unknown>;
    expect(String(info.schema)).toContain('v2.1.0');
    const folder = (get(pm, 'item') as unknown[])[0] as Record<string, unknown>;
    expect(folder.name).toBe('Orders');
    const item = (folder.item as unknown[])[0] as Record<string, unknown>;
    expect(item.name).toBe('Create order');
    const req = item.request as Record<string, unknown>;
    expect(req.method).toBe('POST');
    expect(req.url).toBe("https://${ env('base') }/orders"); // verbatim (conversion is applied upstream)
    expect((req.body as Record<string, unknown>).mode).toBe('raw');
    expect((req.auth as Record<string, unknown>).type).toBe('bearer');
  });

  it('round-trips structure and the common fields through fromPostman', () => {
    const back = fromPostman(toPostman({ name: 'Shop', requests }));
    const r = back.requests[0];
    expect(r.folderPath).toEqual(['Orders']);
    expect(r.request.method).toBe('POST');
    expect(r.request.url).toBe("https://${ env('base') }/orders"); // verbatim round-trip (no {{ }})
    expect(r.request.bodyType).toBe('json');
    expect(r.request.auth?.kind).toBe('bearer');
  });
});
