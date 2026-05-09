const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);
const allowStaticOnlyPreview = process.env.ALLOW_STATIC_ONLY_PREVIEW === '1';

if (!isVercel || allowStaticOnlyPreview) {
  process.exit(0);
}

if (!apiBaseUrl.trim()) {
  throw new Error(
    'EXPO_PUBLIC_API_BASE_URL is required for Vercel deploys. Admin, AI generation, STT, TTS, uploads, and backups need the separately hosted Fastify API.'
  );
}

const apiUrl = new URL(apiBaseUrl);
const vercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map((host) => String(host).replace(/^https?:\/\//, '').replace(/\/$/, ''));

if (vercelHosts.includes(apiUrl.host)) {
  throw new Error(
    'EXPO_PUBLIC_API_BASE_URL must point to the production API host, not the static Vercel frontend host.'
  );
}
