# Swaft documentation site

This folder is the source for the Swaft documentation site, published with **GitHub Pages**
using [Jekyll](https://jekyllrb.com/) and the
[just-the-docs](https://just-the-docs.com/) theme. The content pages are the `*.md` files in
this directory and its subfolders.

## Preview locally

```bash
cd docs
bundle install
bundle exec jekyll serve
# open http://localhost:4000/swaft/
```

## How it is published

The [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) workflow builds this folder
and deploys it to GitHub Pages on every push to `main` (or `docs`) that touches `docs/`.

To enable it once, in the repository: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

If you rename or move the repository, update `url` and `baseurl` in
[`_config.yml`](./_config.yml).

> This `README.md` is excluded from the built site (see `exclude:` in `_config.yml`); the site's
> landing page is [`index.md`](./index.md).
