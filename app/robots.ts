import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // The app is a private business tool — no public content to index.
      // Disallow everything so search engines don't index user dashboards.
      disallow: '/',
    },
  };
}
