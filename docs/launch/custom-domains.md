# Custom domains for the docs sites

Step-by-step runbook to move the published docs from
`duckcode-ai.github.io/{DataLex,dql}/` to the public-facing custom
subdomains. Order matters — DNS first, then `CNAME` files, then Pages UI.

## Target end state

| Domain | Repo | Site |
|---|---|---|
| `datalex.duckcode.ai` | `duckcode-ai/DataLex` | https://duckcode-ai.github.io/DataLex/ → https://datalex.duckcode.ai |
| `dql.duckcode.ai` | `duckcode-ai/dql` | https://duckcode-ai.github.io/dql/ → https://dql.duckcode.ai |

The `mkdocs.yml` `site_url` on each repo already points at the custom
domain, so once DNS + CNAME + Pages are aligned, search engines and the
sitemap pick up the right URL on next deploy.

---

## Step 1 — DNS records (your DNS provider — Cloudflare / Route 53 / Namecheap / …)

Add **two CNAME records** at the apex `duckcode.ai` zone. Both point at
the GitHub Pages org alias.

| Type | Name | Value | TTL |
|---|---|---|---|
| `CNAME` | `datalex` | `duckcode-ai.github.io.` | `300` (5 min) for setup, raise to `3600` after verified |
| `CNAME` | `dql` | `duckcode-ai.github.io.` | `300`, then `3600` |

Notes:

- **Cloudflare specifically** — set the proxy status to **DNS only** (gray
  cloud, not orange). The orange-cloud proxy can interfere with GitHub's
  DNS check during initial verification. Re-enable proxy *after* HTTPS is
  enforced if you want Cloudflare's CDN.
- **Apex domains** like `duckcode.ai` itself need **A records** instead
  (`185.199.108.153`, `109.153`, `110.153`, `111.153`). We're using
  subdomains, so CNAME is correct.
- DNS propagation — usually under 5 minutes; can take up to a few hours
  on the worst-behaved resolvers. Verify with `dig CNAME datalex.duckcode.ai +short`
  showing `duckcode-ai.github.io.` before you continue.

## Step 2 — CNAME files in each repo

GitHub Pages reads a file literally named `CNAME` (no extension) at the
deploy root. mkdocs-material picks up extras from `docs/`, so
`docs/CNAME` ends up at the deploy root automatically.

Create one tiny commit per repo:

```bash
# duckcode-ai/DataLex
git checkout -b docs/custom-domain main
echo "datalex.duckcode.ai" > docs/CNAME
git add docs/CNAME
git commit -m "docs(site): add CNAME for datalex.duckcode.ai"
git push -u origin docs/custom-domain
gh pr create --title "docs(site): add CNAME for datalex.duckcode.ai" --body "Activates the custom domain on GitHub Pages." --base main

# duckcode-ai/dql
git checkout -b docs/custom-domain main
echo "dql.duckcode.ai" > docs/CNAME
git add docs/CNAME
git commit -m "docs(site): add CNAME for dql.duckcode.ai"
git push -u origin docs/custom-domain
gh pr create --title "docs(site): add CNAME for dql.duckcode.ai" --body "Activates the custom domain on GitHub Pages." --base main
```

Both PRs are tiny one-line files, safe to merge immediately. **Don't
merge them before DNS resolves** — once the CNAME file lands, the next
deploy redirects the github.io URL to the custom domain. If DNS isn't
ready, the site goes dark until DNS catches up.

## Step 3 — Pages settings UI per repo

After the CNAME-file PRs merge:

### `duckcode-ai/DataLex`

1. https://github.com/duckcode-ai/DataLex/settings/pages
2. **Custom domain** → enter `datalex.duckcode.ai` → Save.
3. GitHub runs its DNS check (usually 30–60 seconds). Wait for the green
   "DNS check successful" badge.
4. Tick **Enforce HTTPS**. Cert provisioning takes another ~5 minutes;
   you'll see "Your site is published at https://datalex.duckcode.ai"
   when ready.

### `duckcode-ai/dql`

1. https://github.com/duckcode-ai/dql/settings/pages
2. Same: enter `dql.duckcode.ai`, Save, wait for DNS check, tick
   **Enforce HTTPS**.

## Step 4 — Verify

```bash
# DNS resolves
dig CNAME datalex.duckcode.ai +short    # → duckcode-ai.github.io.
dig CNAME dql.duckcode.ai +short        # → duckcode-ai.github.io.

# HTTPS works, no redirect loop
curl -sI https://datalex.duckcode.ai/ | head -5
curl -sI https://dql.duckcode.ai/ | head -5
# expect: HTTP/2 200, server: GitHub.com

# Old github.io URL redirects to the new domain (301)
curl -sI https://duckcode-ai.github.io/DataLex/ | head -5
curl -sI https://duckcode-ai.github.io/dql/ | head -5
# expect: HTTP/2 301, location: https://datalex.duckcode.ai/  (and analogous for dql)
```

## Step 5 — Update everything that linked to the old URL

A grep-and-replace pass once HTTPS is green on both:

```bash
# DataLex repo
rg -l "duckcode-ai.github.io/DataLex" \
  | xargs sed -i '' 's|duckcode-ai.github.io/DataLex|datalex.duckcode.ai|g'
git diff --stat   # sanity-check the touched files

# DQL repo
rg -l "duckcode-ai.github.io/dql" \
  | xargs sed -i '' 's|duckcode-ai.github.io/dql|dql.duckcode.ai|g'
```

Targets to update:

- `README.md` (both repos) — badges, docs link
- `mkdocs.yml` `site_url` — already correct, no change needed
- The unified tutorial at `docs/tutorials/datalex-plus-dql-end-to-end.md`
- The launch post drafts under `docs/launch/posts/*.md` — currently
  reference the github.io URLs as fallbacks
- The companion sister-site links in each docs `index.md`

Land the search-and-replace as one PR per repo. Squash-merge.

## Rollback

If something breaks (cert provisioning stuck, DNS misconfigured, redirect
loop):

1. Pages settings → **Remove custom domain** → Save. Site immediately
   reverts to `duckcode-ai.github.io/<repo>/`.
2. Delete `docs/CNAME` and re-deploy. Mkdocs build won't include the
   redirect.
3. Diagnose DNS / cert separately, retry from Step 2.

Total time on a clean run: **~15 minutes per repo**, mostly waiting
for DNS propagation and cert provisioning.
