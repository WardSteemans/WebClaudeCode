import { hasImages, extractImages, rewriteBody, stripImages } from './services/api-router.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} — FAIL`);
  }
}

// ── Test fixtures ──

const textOnly = {
  messages: [{ content: [{ type: 'text', text: 'hello' }] }]
};

const withImage = {
  messages: [{
    content: [
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }
    ]
  }]
};

const nestedImage = {
  messages: [{
    content: [{
      tool_result: {
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'def' } }]
      }
    }]
  }]
};

const multiImage = {
  messages: [{
    content: [
      { type: 'text', text: 'compare' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'img2' } }
    ]
  }]
};

// ── hasImages ──
console.log('hasImages:');
assert(hasImages(null) === false, 'null');
assert(hasImages(42) === false, 'number');
assert(hasImages({}) === false, 'empty obj');
assert(hasImages('hello') === false, 'string');
assert(hasImages(textOnly) === false, 'text only');
assert(hasImages(withImage) === true, 'direct image');
assert(hasImages(nestedImage) === true, 'nested image in tool_result');

// ── extractImages ──
console.log('extractImages:');
const images = extractImages(withImage);
assert(images.length === 1, '1 image extracted');
assert(images[0].source.data === 'abc', 'correct data');

const nested = extractImages(nestedImage);
assert(nested.length === 1, '1 nested image');
assert(nested[0].source.data === 'def', 'correct nested data');

assert(extractImages(textOnly).length === 0, 'no images in text');

// ── rewriteBody ──
console.log('rewriteBody:');
const rewritten = rewriteBody(structuredClone(withImage), 'A blue header screenshot') as Record<string, unknown>;
const rc = (rewritten.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(rc.length === 2, 'still 2 blocks');
assert(rc[0].type === 'text' && rc[0].text === 'look', 'text preserved');
assert(rc[1].type === 'text', 'image → text');
assert(rc[1].text.includes('blue header'), 'description injected');

// ── stripImages ──
console.log('stripImages:');
const stripped = stripImages(structuredClone(withImage)) as Record<string, unknown>;
const sc = (stripped.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(sc.length === 1, 'only 1 block');
assert(sc[0].type === 'text', 'text block');
assert(sc[0].text === 'look', 'text intact');

const strippedNested = stripImages(structuredClone(nestedImage)) as Record<string, unknown>;
const snc = (strippedNested.messages as Array<{ content: unknown[] }>)[0].content;
assert(snc.length === 1, 'nested image stripped');

// ── Multiple images ──
console.log('multiple images:');
assert(hasImages(multiImage) === true, 'detects multiple');
const multi = extractImages(multiImage);
assert(multi.length === 2, '2 images extracted');
const multiRewritten = rewriteBody(structuredClone(multiImage), 'desc') as Record<string, unknown>;
const mrc = (multiRewritten.messages as Array<{ content: Array<{ type: string; text: string }> }>)[0].content;
assert(mrc.length === 3, 'still 3 blocks');
assert(mrc[0].type === 'text', 'text preserved');
assert(mrc[1].type === 'text' && mrc[1].text.includes('desc'), 'img1 → text');
assert(mrc[2].type === 'text' && mrc[2].text.includes('desc'), 'img2 → text');

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
