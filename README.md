# Connexy

A React + TypeScript + Vite web app, using Supabase for the backend and the Google Maps JavaScript API for location features.

## Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root with the following variables:

```bash
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
VITE_GOOGLE_MAP_ID=your-google-map-id
```

Start the dev server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — type-check with `tsc` and build for production
- `npm run lint` — run ESLint
- `npm run preview` — preview the production build locally
