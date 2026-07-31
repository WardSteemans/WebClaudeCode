import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { OKF_CACHE_DIR } from '@cc-gui/shared';

export function buildOkfContextString(projectRoot: string): string {
  const cacheDir = join(projectRoot, OKF_CACHE_DIR);
  if (!existsSync(cacheDir)) return '';

  const files = readdirSync(cacheDir).filter(f => f.endsWith('.okf.md'));
  if (files.length === 0) return '';

  const parts: string[] = [];

  for (const file of files.sort()) {
    const content = readFileSync(join(cacheDir, file), 'utf-8');
    const entityName = basename(file, '.okf.md');
    parts.push(`<okf_file name="${entityName}">\n${content}\n</okf_file>`);
  }

  return `<okf_context>\n${parts.join('\n\n')}\n</okf_context>`;
}

export interface CacheControlBlock {
  type: 'text';
  text: string;
  cache_control: { type: 'ephemeral' };
}

export function buildCacheControlBlock(okfString: string): CacheControlBlock {
  return {
    type: 'text',
    text: okfString,
    cache_control: { type: 'ephemeral' },
  };
}

export function injectOkfIntoSystem(
  systemBlocks: Array<{ type: string; text?: string; cache_control?: { type: string } }>,
  okfString: string,
): Array<{ type: string; text?: string; cache_control?: { type: string } }> {
  if (!okfString) return systemBlocks;

  const blocks = [...systemBlocks];

  // Insert OKF context at position 0 (first system block).
  // DeepSeek caches automatic prefix matches — placing OKF at the start
  // ensures every request shares it as a cacheable prefix. The cache_control
  // annotation is still respected by Anthropic but silently ignored by DeepSeek.
  const insertAt = 0;
  blocks.splice(insertAt, 0, {
    type: 'text',
    text: okfString,
    cache_control: { type: 'ephemeral' },
  });

  return blocks;
}
