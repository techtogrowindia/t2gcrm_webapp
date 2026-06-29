# T2G CRM — Marketing Landing Page

A fast, SEO-optimized, conversion-focused landing page for T2G CRM.
**Zero dependencies** — plain HTML/CSS/JS. Loads instantly, ranks well, works everywhere.

```
web/
├── index.html     # the page (all sections + SEO meta + JSON-LD structured data)
├── styles.css     # brand-matched styling (green #22c55e / #16a34a, DM Sans)
├── script.js      # scroll-reveal, sticky header, FAQ accordion (vanilla JS)
├── robots.txt     # search-engine directives
├── sitemap.xml    # sitemap for Google Search Console
└── README.md      # this file
```

## What's inside (conversion structure)

The page follows the highest-converting global SaaS landing pattern:

1. **Hero** — clear promise + CTA above the fold + live app mockup
2. **Social proof strip** — real usage numbers (80k+ records, 11k+ leads, 27k+ calls)
3. **Pain / agitation** — the 6 problems every Indian SMB feels
4. **About / solution** — what T2G CRM is, with an invoice mockup
5. **Who it's for** — 6 target segments
6. **Features** — 9 feature cards (WhatsApp automation highlighted)
7. **How it helps** — 3-step flow
8. **Benefits / why necessary** — outcome-focused
9. **Testimonials** — social proof (⚠️ replace with real ones — see below)
10. **Final CTA band** — strong close with WhatsApp demo option
11. **FAQ** — objection-handling + SEO (FAQPage structured data)
12. **Footer** — local SEO (Coimbatore, Chennai, Madurai)
13. **Floating WhatsApp button** — high-converting in India

## SEO built in

- Optimized `<title>` + meta description targeting *"CRM software Tamil Nadu"*, *"GST billing"*, *"WhatsApp CRM"*, *"IndiaMART lead management"*
- Open Graph + Twitter cards for rich social sharing
- **JSON-LD structured data**: `SoftwareApplication`, `Organization`, `FAQPage` → eligible for Google rich results
- `geo.region = IN-TN` for local relevance
- Semantic HTML5, `lang="en"`, canonical URL, sitemap + robots
- No framework / no render-blocking JS → fast Core Web Vitals (a Google ranking factor)

## ⚠️ Before you go live — replace these placeholders

| Placeholder | Where | Replace with |
|---|---|---|
| `910000000000` | `index.html` (3 WhatsApp links + footer) | Your real WhatsApp business number (with country code, no +) |
| **Testimonials** | `index.html` `#testimonials` | **Real** customer quotes + names. Fake testimonials violate ad/Google policies — use genuine ones with permission. |
| `og-image.png` | meta tags | A 1200×630 social-share image (add to `web/`) |
| `logo.png` | Organization JSON-LD | Your logo URL |
| Footer cities | `#footer` | Make the city links point to real local pages if you build them |

> **Note on ratings:** I deliberately did **not** add a fake `AggregateRating` to the
> structured data. Google penalizes self-serving/invented review stars. Add real
> ratings only once you collect verifiable reviews.

> **Note on screenshots:** The "app screenshots" are hand-built HTML/CSS mockups with
> safe demo data — **not** real screenshots, because the live app shows real customer
> names, phone numbers and revenue (PII). Never put real customer data on a public page.
> If you want real-looking screens, create a demo tenant with fake data and screenshot that.

## Run locally

```bash
cd web
npx http-server . -p 4178
# open http://localhost:4178
```

## Deploy options

**A. Subdomain (recommended):** host on `www.t2gcrm.in` or `t2gcrm.in`, keep the app on `crm.t2gcrm.in`.
Point the marketing domain's web root at this `web/` folder (Nginx static, Netlify, Vercel, Cloudflare Pages — all work with zero config).

**B. Same VPS (Nginx):** serve `web/` as a static site on a new server block:
```nginx
server {
  server_name t2gcrm.in www.t2gcrm.in;
  root /var/www/t2g-landing/web;
  index index.html;
  location / { try_files $uri $uri/ =404; }
}
```

**C. Quick test:** any static host (GitHub Pages, Netlify drag-and-drop).

After deploying, submit `sitemap.xml` in **Google Search Console** and set up a
Google Business Profile for Tamil Nadu local SEO.
