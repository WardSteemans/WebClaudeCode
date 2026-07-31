import { Project, SyntaxKind, type ParameterDeclaration, type ClassDeclaration, type InterfaceDeclaration, type EnumDeclaration, type FunctionDeclaration, type VariableStatement } from 'ts-morph';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { OkfDocument, OkfFrontmatter, OkfMethod, OkfParam, OkfEntityType } from '@cc-gui/shared';
import { OKF_CACHE_DIR } from '@cc-gui/shared';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isSourceFile(filepath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(filepath).toLowerCase());
}

function extractParams(params: ParameterDeclaration[]): OkfParam[] {
  return params.map(p => ({
    name: p.getName(),
    type: p.getType().getText(),
    isOptional: p.isOptional(),
    defaultValue: p.getInitializer()?.getText(),
  }));
}

function extractClassMethods(node: ClassDeclaration): OkfMethod[] {
  return node.getMethods().map(m => ({
    name: m.getName(),
    visibility: (m.getScope() as string) === 'private' ? 'private' : (m.getScope() as string) === 'protected' ? 'protected' : 'public',
    isStatic: m.isStatic(),
    isAsync: m.isAsync(),
    returnType: m.getReturnType().getText(),
    params: extractParams(m.getParameters()),
    jsdoc: m.getJsDocs()[0]?.getDescription().trim() || undefined,
  }));
}

function extractInterfaceMethods(node: InterfaceDeclaration): OkfMethod[] {
  return node.getMethods().map(m => ({
    name: m.getName(),
    visibility: 'public' as const,
    isStatic: false,
    isAsync: false,
    returnType: m.getReturnType().getText(),
    params: extractParams(m.getParameters()),
    jsdoc: m.getJsDocs()[0]?.getDescription().trim() || undefined,
  }));
}

function extractProperties(node: ClassDeclaration | InterfaceDeclaration): string[] {
  return node.getProperties().map(p => p.getName());
}

function extractDependencies(sourceFile: ReturnType<Project['getSourceFile']>): string[] {
  if (!sourceFile) return [];
  return sourceFile.getImportDeclarations().map(decl => decl.getModuleSpecifierValue());
}

function extractSummary(node: { getJsDocs(): Array<{ getDescription(): { trim(): string } }> }): string {
  const jsDocs = node.getJsDocs();
  return jsDocs[0]?.getDescription().trim() || '';
}

function formatMethodSignature(m: OkfMethod): string {
  const parts: string[] = [];
  if (m.isStatic) parts.push('static');
  if (m.isAsync) parts.push('async');
  parts.push(m.name);
  parts.push(`(${m.params.map(p => {
    let s = p.name;
    if (p.type && p.type !== 'any') s += `: ${p.type}`;
    if (p.defaultValue) s += ` = ${p.defaultValue}`;
    return s;
  }).join(', ')})`);
  if (m.returnType && m.returnType !== 'void') parts.push(`: ${m.returnType}`);
  return parts.join(' ');
}

function toYamlList(items: string[]): string {
  if (items.length === 0) return '[]';
  return '[' + items.map(i => `"${i.replace(/"/g, '\\"')}"`).join(', ') + ']';
}

function generateOkfMarkdown(doc: OkfDocument): string {
  const fm = doc.frontmatter;
  const lines: string[] = [
    '---',
    `type: "${fm.type}"`,
    `name: "${fm.name}"`,
    `filepath: "${fm.filepath}"`,
    `dependencies: ${toYamlList(fm.dependencies)}`,
    `exports: ${toYamlList(fm.exports)}`,
    '---',
    '',
  ];

  if (doc.summary) {
    lines.push('## Summary', '', doc.summary, '');
  }

  if (doc.methods.length > 0) {
    lines.push('## Methods', '');
    for (const m of doc.methods) {
      lines.push(`### \`${m.visibility}${m.isStatic ? ' static' : ''} ${formatMethodSignature(m)}\``);
      if (m.jsdoc) lines.push('', m.jsdoc, '');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function getVariableName(node: VariableStatement): string | undefined {
  const decls = node.getDeclarationList().getDeclarations();
  return decls[0]?.getName();
}

function getEntityName(node: ClassDeclaration | InterfaceDeclaration | EnumDeclaration | FunctionDeclaration | VariableStatement): string | undefined {
  const kind = node.getKind();
  if (kind === SyntaxKind.VariableStatement) {
    return getVariableName(node as VariableStatement);
  }
  return (node as ClassDeclaration | InterfaceDeclaration | EnumDeclaration | FunctionDeclaration).getName();
}

export function extractToOkf(filepath: string, projectRoot: string): void {
  const filepathNormalized = filepath.replace(/\\/g, '/');
  const projectRootNormalized = projectRoot.replace(/\\/g, '/');
  const relPath = filepathNormalized.replace(projectRootNormalized, '').replace(/^\//, '');

  if (!isSourceFile(relPath)) return;
  if (!existsSync(filepath)) return;

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(filepath);

  const cacheDir = join(projectRoot, OKF_CACHE_DIR);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const deps = extractDependencies(sourceFile);

  // Process each entity type
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    const methods = extractClassMethods(cls);
    const props = extractProperties(cls);
    writeOkfFile(cacheDir, relPath, {
      frontmatter: {
        type: 'class',
        name,
        filepath: relPath,
        dependencies: deps,
        exports: [...methods.filter(m => m.visibility === 'public').map(m => m.name), ...props],
      },
      summary: extractSummary(cls),
      methods,
    });
  }

  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    if (!name) continue;
    const methods = extractInterfaceMethods(iface);
    const props = extractProperties(iface);
    writeOkfFile(cacheDir, relPath, {
      frontmatter: {
        type: 'interface',
        name,
        filepath: relPath,
        dependencies: deps,
        exports: [...methods.map(m => m.name), ...props],
      },
      summary: extractSummary(iface),
      methods,
    });
  }

  for (const enm of sourceFile.getEnums()) {
    const name = enm.getName();
    if (!name) continue;
    writeOkfFile(cacheDir, relPath, {
      frontmatter: {
        type: 'enum',
        name,
        filepath: relPath,
        dependencies: deps,
        exports: enm.getMembers().map(m => m.getName()),
      },
      summary: extractSummary(enm),
      methods: [],
    });
  }

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    writeOkfFile(cacheDir, relPath, {
      frontmatter: {
        type: 'function',
        name,
        filepath: relPath,
        dependencies: deps,
        exports: [name],
      },
      summary: extractSummary(fn),
      methods: [],
    });
  }

  for (const vs of sourceFile.getVariableStatements()) {
    if (!vs.hasExportKeyword()) continue;
    const name = getVariableName(vs);
    if (!name) continue;
    writeOkfFile(cacheDir, relPath, {
      frontmatter: {
        type: 'module',
        name,
        filepath: relPath,
        dependencies: deps,
        exports: [name],
      },
      summary: extractSummary(vs),
      methods: [],
    });
  }
}

function writeOkfFile(cacheDir: string, relPath: string, doc: OkfDocument): void {
  const safeName = relPath.replace(/[/\\:]/g, '_').replace(/\.[^.]+$/, '');
  const okfPath = join(cacheDir, `${safeName}.okf.md`);
  writeFileSync(okfPath, generateOkfMarkdown(doc), 'utf-8');
}

export function extractAllSourceFiles(projectRoot: string): void {
  const srcDirs = ['src', 'packages'];
  for (const dir of srcDirs) {
    const fullDir = join(projectRoot, dir);
    if (!existsSync(fullDir)) continue;

    const walk = (current: string): void => {
      const entries = readdirRecursive(current);
      for (const entry of entries) {
        const full = join(current, entry);
        if (full.includes('node_modules') || full.includes('.okf_cache') || full.includes('.git')) continue;
        try {
          extractToOkf(full, projectRoot);
        } catch {
          // skip files that can't be parsed
        }
      }
    };

    walk(fullDir);
  }
}

function readdirRecursive(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          results.push(...readdirRecursive(full).map(e => join(entry, e)));
        } else {
          results.push(entry);
        }
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}

export { isSourceFile, SOURCE_EXTENSIONS };
