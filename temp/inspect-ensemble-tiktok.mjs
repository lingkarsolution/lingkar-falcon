import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^ENSEMBLEDATA_TOKEN=(.+)$/);
  if (match) process.env.ENSEMBLEDATA_TOKEN = match[1];
}

const token = process.env.ENSEMBLEDATA_TOKEN;
if (!token) throw new Error('ENSEMBLEDATA_TOKEN missing');

const url = new URL('https://ensembledata.com/apis/tt/keyword/search');
url.searchParams.set('name', process.argv.slice(2).join(' ') || 'bank nobu bank nobu indonesia');
url.searchParams.set('cursor', '0');
url.searchParams.set('period', '30');
url.searchParams.set('sorting', '2');
url.searchParams.set('match_exactly', 'false');
url.searchParams.set('get_author_stats', 'false');
url.searchParams.set('token', token);

const response = await fetch(url);
const json = await response.json();

const keys = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
const arrayInfo = (label, value) => Array.isArray(value) ? { label, count: value.length, firstKeys: keys(value[0]).slice(0, 40) } : null;
const root = json?.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
const candidates = [
  arrayInfo('json.data', json.data),
  arrayInfo('root.data', root?.data),
  arrayInfo('root.posts', root?.posts),
  arrayInfo('root.videos', root?.videos),
  arrayInfo('root.aweme_list', root?.aweme_list),
  arrayInfo('root.results', root?.results),
  arrayInfo('root.items', root?.items),
].filter(Boolean);

console.log(JSON.stringify({
  httpStatus: response.status,
  ok: response.ok,
  rootKeys: keys(json),
  dataKeys: keys(json.data),
  candidateArrays: candidates,
}, null, 2));
