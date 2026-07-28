import { hasImages, extractImages, rewriteBody, stripImages, buildUpstreamUrl } from './services/api-router.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — FAIL`); }
}

// ── Test fixtures ──
const textOnly = { messages: [{ content: [{ type: 'text', text: 'hello' }] }] };

const withImage = { messages: [{ content: [
  { type: 'text', text: 'look' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }
]}]};

const nestedImage = { messages: [{ content: [{
  tool_result: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'def' } }] }
}]}]};

const multiImage = { messages: [{ content: [
  { type: 'text', text: 'compare' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } },
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'img2' } }
]}]};

const onlyImages = { messages: [{ content: [
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'sole' } }
]}]};

// ── hasImages ──
console.log('hasImages:');
assert(hasImages(null) === false, 'null');
assert(hasImages(42) === false, 'number');
assert(hasImages({}) === false, 'empty obj');
assert(hasImages('hello') === false, 'string');
assert(hasImages(textOnly) === false, 'text only');
assert(hasImages(withImage) === true, 'direct image');
assert(hasImages(nestedImage) === true, 'nested image');

// ── extractImages ──
console.log('extractImages:');
assert(extractImages(withImage).length === 1, '1 image');
assert(extractImages(withImage)[0].source.data === 'abc', 'correct data');
assert(extractImages(nestedImage).length === 1, 'nested');
assert(extractImages(nestedImage)[0].source.data === 'def', 'nested data');
assert(extractImages(textOnly).length === 0, 'no images in text');
assert(extractImages(multiImage).length === 2, '2 images');

// ── rewriteBody ──
console.log('rewriteBody:');
const rw = rewriteBody(structuredClone(withImage), 'A blue header screenshot') as Record<string, unknown>;
const rc = (rw.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(rc.length === 2, 'still 2 blocks');
assert(rc[0].type === 'text' && rc[0].text === 'look', 'text preserved');
assert(rc[1].type === 'text' && rc[1].text.includes('blue header'), 'description injected');

// ── stripImages ──
console.log('stripImages:');
const st = stripImages(structuredClone(withImage)) as Record<string, unknown>;
const sc = (st.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(sc.length === 1, 'only text block remains');
assert(sc[0].type === 'text', 'text block');
assert(sc[0].text === 'look', 'text intact');

const stOnly = stripImages(structuredClone(onlyImages)) as Record<string, unknown>;
const so = (stOnly.messages as Array<{ content: unknown[] }>)[0].content;
assert(so.length === 0, 'all-image content → empty array');

const stNested = stripImages(structuredClone(nestedImage)) as Record<string, unknown>;
const sn = (stNested.messages as Array<{ content: unknown[] }>)[0].content;
assert(sn.length === 1, 'nested image stripped, container remains');

// ── Multiple images ──
console.log('multiple images:');
assert(hasImages(multiImage) === true, 'detects multiple');
const mrw = rewriteBody(structuredClone(multiImage), 'desc') as Record<string, unknown>;
const mrc = (mrw.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(mrc.length === 3, '3 blocks');
assert(mrc[1].type === 'text' && mrc[1].text.includes('desc'), 'img1 → text');
assert(mrc[2].type === 'text' && mrc[2].text.includes('desc'), 'img2 → text');

// ── URL construction (regression: new URL() dropping /anthropic) ──
console.log('buildUpstreamUrl:');
{
  const u = buildUpstreamUrl('https://api.deepseek.com/anthropic');
  assert(u.hostname === 'api.deepseek.com', 'hostname preserved');
  assert(u.path === '/anthropic/v1/messages', 'path includes /anthropic');
  assert(u.port === 443, 'default https port');
}
{
  const u = buildUpstreamUrl('https://api.deepseek.com/anthropic/');
  assert(u.path === '/anthropic/v1/messages', 'trailing slash stripped');
}
{
  const u = buildUpstreamUrl('https://api.deepseek.com');
  assert(u.path === '/v1/messages', 'no base path → /v1/messages');
}
{
  const u = buildUpstreamUrl('https://openrouter.ai/api/v1');
  assert(u.path === '/api/v1/v1/messages', 'nested path preserved');
}
{
  const u = buildUpstreamUrl('http://localhost:8080/custom/path');
  assert(u.hostname === 'localhost', 'localhost hostname');
  assert(u.port === 8080, 'custom port');
  assert(u.path === '/custom/path/v1/messages', 'custom path preserved');
}

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
