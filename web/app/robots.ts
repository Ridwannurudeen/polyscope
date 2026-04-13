import type { MetadataRoute } from "next";

const SITE = "https://polyscope.gudman.xyz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/admin/",
          "/api/events",
          "/api/portfolio",
          "/api/watchlist",
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
