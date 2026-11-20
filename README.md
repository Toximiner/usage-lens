# Universal Usage Lens

Reference counts above symbols, without blank rows for hidden CodeLens entries.

## Features

- Hide zero-reference counts **and their reserved rows** by default.
- Include imports and exclude declarations by default.
- Python classes, methods and functions; TypeScript / JavaScript symbols, including React components, interfaces and enums.
- CSS-family symbols where a language server provides document symbols and references.
- Click counts to open references preview or choose direct navigation.
- Limit concurrent reference queries, deduplicate results and retry during initial language-server indexing.
- No telemetry, project execution or network uploads. Language servers determine references.

## Language support

| Language | Provider |
| --- | --- |
| Python | Pylance, ty or another symbol/reference provider |
| TypeScript, TSX, JavaScript, JSX | VS Code built-in TypeScript language features |
| CSS, SCSS, Less | VS Code built-in CSS language features; references are typically limited to the current stylesheet |
| PostCSS (`.pcss`) | A provider supporting `postcss`, or CSS language mode via `files.associations`; parser support for custom mixins is provider-dependent |
| Other languages | Add language IDs to `usageLens.languages`; a symbol/reference provider is required |

CSS selector occurrences are not automatically equivalent to HTML / JSX `className` uses. This extension does not guess cross-language uses by text matching. Unsupported symbols produce no counts or extra rows.

Disable **Python Code Lens - Lite** in the workspace to avoid duplicate Python lenses.

## Settings

| Setting | Default |
| --- | --- |
| `usageLens.references.showZero` | `false` |
| `usageLens.references.minCount` | `0` |
| `usageLens.references.filterImports` | `false` |
| `usageLens.references.filterDefinitions` | `true` |
| `usageLens.lenses.showImplementations` | `false` (Python-only) |
| `usageLens.clickAction` | `"peek"` |

**Universal Usage Lens: Refresh Lenses** clears cached counts. Indexing may take time on large projects.

## Build

```sh
npm ci --ignore-scripts
npm test
npm run package
```

Install the resulting VSIX with **Extensions: Install from VSIX…**.

## Validation

Unit regressions cover hidden rows, import inclusion, declaration exclusion, minimum counts, empty-result retry and cancellation. The VS Code integration suite in `scripts/test-vscode.cjs` uses fictional examples in `test-fixtures`: Python, TS, TSX, JS, JSX, CSS and PostCSS in CSS mode. It requires Pylance plus VS Code built-in TypeScript and CSS language features. No private project sources are included.

## Credits and license

Fork of [Python Code Lens - Lite](https://github.com/rafaelpeter03/python-codelens-lite) by [RafaelPeter](https://github.com/rafaelpeter03), under the MIT license. Original author and license notices are retained. This fork has a separate extension ID, commands and settings.
