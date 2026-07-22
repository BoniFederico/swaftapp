import { describe, expect, it } from 'vitest';
import { fromBruno, toBruno, type BrunoFile } from './bruno';
import type { ImportedRequest } from './collection';

const requests: ImportedRequest[] = [
  {
    name: 'Get order',
    folderPath: ['Orders'],
    request: {
      method: 'GET',
      url: "https://${ env('base') }/orders/${ id }",
      headers: { Accept: 'application/json' },
      auth: { kind: 'bearer', token: "${ secret('TOKEN') }" },
    },
  },
  {
    name: 'Create order',
    folderPath: ['Orders'],
    request: {
      method: 'POST',
      url: "https://${ env('base') }/orders",
      body: '{"n":"Rex"}',
      bodyType: 'json',
    },
  },
];

describe('toBruno', () => {
  it('emits a bruno.json and one .bru per request under its folder path', () => {
    const files = toBruno({ name: 'Shop', requests });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('bruno.json');
    expect(paths).toContain('Orders/Get order.bru');
    expect(paths).toContain('Orders/Create order.bru');
    expect(JSON.parse(files[0].content).name).toBe('Shop');
  });

  it('serializes Seebo verbatim and includes meta/method/headers/auth/body blocks', () => {
    const bru = toBruno({ name: 'Shop', requests }).find((f) => f.path.endsWith('Get order.bru'))!.content;
    expect(bru).toContain('name: Get order');
    expect(bru).toContain("url: https://${ env('base') }/orders/${ id }");
    expect(bru).toContain('auth: bearer');
    expect(bru).toContain("token: ${ secret('TOKEN') }");
    expect(bru).toContain('Accept: application/json');
  });
});

describe('fromBruno', () => {
  it('round-trips structure and fields (verbatim), reading folder path from the file path', () => {
    const files = toBruno({ name: 'Shop', requests });
    const col = fromBruno(files);
    expect(col.name).toBe('Shop');
    expect(col.requests).toHaveLength(2);

    const get = col.requests.find((r) => r.name === 'Get order')!;
    expect(get.folderPath).toEqual(['Orders']);
    expect(get.request.method).toBe('GET');
    expect(get.request.url).toBe("https://${ env('base') }/orders/${ id }");
    expect(get.request.headers).toEqual({ Accept: 'application/json' });
    expect(get.request.auth).toEqual({ kind: 'bearer', token: "${ secret('TOKEN') }" });

    const post = col.requests.find((r) => r.name === 'Create order')!;
    expect(post.request.bodyType).toBe('json');
    expect(JSON.parse(post.request.body!)).toEqual({ n: 'Rex' });
  });

  it('translates {{var}} to ${ var } on import', () => {
    const files: BrunoFile[] = [
      { path: 'bruno.json', content: '{"name":"X"}' },
      {
        path: 'Get.bru',
        content: 'meta {\n  name: Get\n}\nget {\n  url: https://{{base}}/x\n  body: none\n  auth: none\n}\n',
      },
    ];
    expect(fromBruno(files).requests[0].request.url).toBe('https://${ base }/x');
  });

  it('is tolerant of junk files', () => {
    expect(fromBruno([{ path: 'readme.md', content: 'hi' }]).requests).toEqual([]);
  });
});
