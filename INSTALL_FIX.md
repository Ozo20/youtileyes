# Planning horizon TypeScript fix

This package contains a complete replacement for:

- `scripts/build-solver-input.ts`

The change keeps `planningAsOfDate`, `planningStartDate`, and `planningEndDate` in local non-null constants immediately after the existing runtime validation. This lets TypeScript preserve the narrowing inside nested callbacks.

## Install

From the Youtileyes project root, copy the supplied file over the existing file, then run:

```bash
rm -rf .next
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

If green, continue with:

```bash
source solver/.venv/bin/activate
npm run solver:test:core
npm run solver:test:preferences
npm run solver:test:contract
npm run solver:test:horizon
```
