import * as vscode from 'vscode';
import { isImportCategoryEnabled, ResolvedConfig } from './config';
import { Category, classifyUri } from './classifier';
import { isLineAnImport } from './importDetector';

export interface EligibleSymbol {
    kind: 'type' | 'selector' | 'class' | 'method' | 'function' | 'moduleVar' | 'import' | 'class-impl';
    name: string;
    range: vscode.Range;
    selectionRange: vscode.Range;
    symbol: vscode.DocumentSymbol;
    importCategory?: Category;
}

export async function getEligibleSymbols(
    document: vscode.TextDocument,
    config: ResolvedConfig
): Promise<EligibleSymbol[]> {
    if (document.languageId !== 'python') { return getGenericSymbols(document, config); }
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
    );

    if (!symbols) {
        return [];
    }

    const eligibleSymbols: EligibleSymbol[] = [];
    const importsEnabled = config.targets.imports.global ||
        config.targets.imports.project ||
        config.targets.imports.stdlib ||
        config.targets.imports.venv;

    async function traverse(syms: vscode.DocumentSymbol[], isTopLevel: boolean, inClass: boolean): Promise<void> {
        for (const sym of syms) {
            if (isTopLevel && isLineAnImport(document, sym.range.start.line)) {
                if (importsEnabled) {
                    const importCategory = await resolveImportCategory(document.uri, sym.selectionRange.start);
                    if (isImportCategoryEnabled(importCategory, config)) {
                        eligibleSymbols.push({
                            kind: 'import',
                            name: sym.name,
                            range: sym.range,
                            selectionRange: sym.selectionRange,
                            symbol: sym,
                            importCategory
                        });
                    }
                }
                continue;
            }

            if (sym.kind === vscode.SymbolKind.Class && config.targets.classes) {
                eligibleSymbols.push({
                    kind: 'class',
                    name: sym.name,
                    range: sym.range,
                    selectionRange: sym.selectionRange,
                    symbol: sym
                });
            }

            if ((sym.kind === vscode.SymbolKind.Method || sym.kind === vscode.SymbolKind.Function) &&
                inClass && config.targets.methods) {
                eligibleSymbols.push({
                    kind: 'method',
                    name: sym.name,
                    range: sym.range,
                    selectionRange: sym.selectionRange,
                    symbol: sym
                });
            }

            if (sym.kind === vscode.SymbolKind.Function && !inClass && isTopLevel && config.targets.functions) {
                eligibleSymbols.push({
                    kind: 'function',
                    name: sym.name,
                    range: sym.range,
                    selectionRange: sym.selectionRange,
                    symbol: sym
                });
            }

            if ((sym.kind === vscode.SymbolKind.Variable || sym.kind === vscode.SymbolKind.Constant) &&
                isTopLevel && config.targets.moduleVariables) {
                eligibleSymbols.push({
                    kind: 'moduleVar',
                    name: sym.name,
                    range: sym.range,
                    selectionRange: sym.selectionRange,
                    symbol: sym
                });
            }

            if (sym.children && sym.children.length > 0) {
                await traverse(sym.children, false, sym.kind === vscode.SymbolKind.Class || inClass);
            }
        }
    }

    await traverse(symbols, true, false);

    return eligibleSymbols;
}

async function resolveImportCategory(uri: vscode.Uri, position: vscode.Position): Promise<Category> {
    try {
        const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        ) || [];

        const definition = definitions[0];
        if (!definition) {
            return 'global';
        }

        return classifyUri('targetUri' in definition ? definition.targetUri : definition.uri);
    } catch {
        return 'global';
    }
}


/** Language-server symbols keep React components, aliases and declarations semantic. */
async function getGenericSymbols(document: vscode.TextDocument, config: ResolvedConfig): Promise<EligibleSymbol[]> {
    const provided = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
        'vscode.executeDocumentSymbolProvider', document.uri
    ) || [];
    const result: EligibleSymbol[] = [];
    const style = ['css', 'scss', 'less', 'postcss'].includes(document.languageId);
    const seen = new Set<string>();
    const visit = (symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>, topLevel: boolean) => {
        for (const symbol of symbols) {
            const hierarchical = 'selectionRange' in symbol;
            const range = hierarchical ? symbol.range : symbol.location.range;
            let selectionRange = hierarchical ? symbol.selectionRange : range;
            // CSS providers may return the whole rule as the selection. Position
            // the query on its first identifier rather than the selector prefix.
            if (style) {
                const line = document.lineAt(selectionRange.start.line).text;
                const tail = line.slice(selectionRange.start.character);
                const match = /[a-zA-Z_$-][\w$-]*/.exec(tail);
                if (match) {
                    const start = new vscode.Position(selectionRange.start.line, selectionRange.start.character + match.index);
                    selectionRange = new vscode.Range(start, start.translate(0, match[0].length));
                }
            }
            let kind: EligibleSymbol['kind'] | undefined;
            if (style) {
                if (symbol.kind === vscode.SymbolKind.Class || symbol.kind === vscode.SymbolKind.Module) { kind = 'selector'; }
                else if (symbol.kind === vscode.SymbolKind.Variable || symbol.kind === vscode.SymbolKind.Constant) { kind = 'moduleVar'; }
            } else {
                if (symbol.kind === vscode.SymbolKind.Class && config.targets.classes) { kind = 'class'; }
                else if ([vscode.SymbolKind.Interface, vscode.SymbolKind.Enum, vscode.SymbolKind.Struct, vscode.SymbolKind.TypeParameter].includes(symbol.kind) && config.targets.types) { kind = 'type'; }
                else if ([vscode.SymbolKind.Method, vscode.SymbolKind.Constructor].includes(symbol.kind) && config.targets.methods) { kind = 'method'; }
                else if (symbol.kind === vscode.SymbolKind.Function && config.targets.functions) { kind = 'function'; }
                else if ([vscode.SymbolKind.Variable, vscode.SymbolKind.Constant].includes(symbol.kind) && topLevel && config.targets.moduleVariables) { kind = 'moduleVar'; }
            }
            const key = `${selectionRange.start.line}:${selectionRange.start.character}`;
            if (kind && !seen.has(key)) {
                seen.add(key);
                result.push({kind, name: symbol.name, range, selectionRange, symbol: symbol as vscode.DocumentSymbol});
            }
            if (hierarchical && symbol.children.length) { visit(symbol.children, false); }
        }
    };
    visit(provided, true);
    return result;
}
