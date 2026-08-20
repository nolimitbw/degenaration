# Xzy lives here, but is not part of degenaration

This folder is a **standalone application**. It is stored inside this repository only
because it needs somewhere to live; it shares nothing with degenaration:

- Its own `package.json`, `node_modules`, `tsconfig.json`, and Tailwind config.
- Its own Supabase schema and tables. No table, migration, or RPC is shared.
- Its own deployment, environment variables, and secrets.
- No imports in either direction. Nothing in `xzy/` reads anything above it, and nothing
  in degenaration reads anything in here.

The root `tsconfig.json` excludes `xzy`, so degenaration's typecheck and build ignore it
entirely. Work on Xzy from inside this directory:

```bash
cd xzy
npm install
npm run check
```

Xzy also has its own git history, kept as a bundle outside this repo. If it ever gets its
own GitHub repository, this folder moves there wholesale and nothing here needs untangling.
