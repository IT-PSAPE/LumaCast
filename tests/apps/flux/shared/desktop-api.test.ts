import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { APP_IDENTITY } from '../../../../apps/flux/main/app-identity';

const CONTRACT_PATH = path.resolve(__dirname, '../../../../apps/flux/shared/desktop-api.ts');

describe('apps/flux DesktopAPI contract', () => {
  const source = readFileSync(CONTRACT_PATH, 'utf8');

  it('declares exactly the capabilities the Lumaflux screens use', () => {
    const methods = [...source.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);

    expect(methods).toEqual([
      'platform',
      'command',
      'chooseImport',
      'chooseDirectory',
      'chooseRelink',
      'preview',
      'assetUrl',
      'pathsForFiles',
      'onChange',
      'onMenuCommand',
      'settings',
      'updateSettings',
    ]);
  });

  it('stays process-neutral, so main and the renderer can share it', () => {
    // A contract module is imported from both processes. Naming Electron, a
    // Node builtin, or a Node-side photo package here would drag a runtime into
    // one of them.
    expect(source).not.toMatch(/from ['"]electron['"]/);
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toContain('@lumacast/photo-imaging');
    expect(source).not.toContain('@lumacast/photo-library');
    const commands = readFileSync(path.join(path.dirname(CONTRACT_PATH), 'photo-command.ts'), 'utf8');
    expect(commands).not.toMatch(/from ['"](?:electron|node:)/);
    expect(commands).not.toMatch(/from ['"]@lumacast\/photo-(?:imaging|library)/);
  });

  it('types every supported main command without inventing another command', () => {
    const commandMap = ts.createSourceFile('photo-command.ts',
      readFileSync(path.join(path.dirname(CONTRACT_PATH), 'photo-command.ts'), 'utf8'), ts.ScriptTarget.Latest);
    const map = commandMap.statements.find((node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) && node.name.text === 'PhotoCommandMap');
    expect(map).toBeDefined();
    const declared = map!.members.map((member) => member.name!.getText(commandMap));
    const implementation = ts.createSourceFile('commands.ts',
      readFileSync(path.resolve(__dirname, '../../../../packages/photo-library/src/commands.ts'), 'utf8'), ts.ScriptTarget.Latest);
    const supported: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) supported.push(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(implementation);
    expect(declared.sort()).toEqual(supported.sort());
  });

  it('takes its data types from the renderer-safe photo domain model', () => {
    expect(source).toContain("from '@lumacast/photo-model'");
  });

  it('is not the place the app identity lives, so the renderer never imports main', () => {
    // The contract may *mention* the app in prose; what it must not do is import
    // the identity, which would make the renderer depend on main. Matching the
    // bare product name instead would fail on that prose, so the check is
    // scoped to imports.
    expect(source).not.toContain("from '../main");
    expect(source).not.toMatch(/from ['"][^'"]*app-identity['"]/);
    expect(source).not.toContain(APP_IDENTITY.id);
  });
});
