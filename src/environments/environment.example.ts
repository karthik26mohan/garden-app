// Template for src/environments/environment.ts (which is gitignored because
// it contains real secrets). Copy this file to environment.ts and fill in the
// values for your environment.
//
//   cp src/environments/environment.example.ts src/environments/environment.ts
//
// Then edit environment.ts with real values from:
//   - Supabase dashboard → Project Settings → API
//   - Pl@ntNet developer portal
//
// In CI, environment.ts is generated on the fly with placeholder values
// (the build only needs the file to exist; runtime values come from Vercel).

export const environment = {
  production: false,
  supabase: {
    url: 'https://YOUR-PROJECT.supabase.co',
    anonKey: 'YOUR-ANON-KEY',
  },
  plantnet: {
    apiKey: 'YOUR-PLANTNET-API-KEY',
  },
};
