# Pocket Budget

A personal budget tracker built with Next.js. Track cash and credit-card balances, record spending and top-ups, and save toward goals.

## Run locally

Requires Node.js 20 or later.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint` and `npm run build` to check the project.

## Data and sign-in

The single-user sign-in and budget data are stored in this browser on this device. There is no server-side account, cloud sync, or backup. Clearing browser storage removes the local account and budget data, so this is intended for personal tracking rather than sensitive financial records.

## Deploy to Vercel

The workflow in `.github/workflows/deploy.yml` creates preview deployments for pull requests targeting `main` and production deployments when changes are pushed to `main`.

1. Import this repository into Vercel and create a project.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add these repository secrets:
	- `VERCEL_TOKEN`: a Vercel access token.
	- `VERCEL_ORG_ID`: the Vercel team or account ID.
	- `VERCEL_PROJECT_ID`: the ID of the Vercel project linked to this repository.
3. Push to `main` or open a pull request targeting `main` to start a deployment.
