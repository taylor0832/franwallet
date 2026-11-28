# FranWallet brand assets · November 28, 2026

Use the approved layered wallet unchanged. The folded back, coral card, white front and rounded closure are the master geometry. The navbar SVG crops surrounding space; it does not redraw the wallet.

- Wordmark: original website **Fraunces 700**, supporting copy **DM Sans**.
- Colors: teal **#0A3D3D**, coral **#E8734A**, white **#FFFFFF**.
- Browser / app / store mark: `franwallet-icon.svg`, or 512 / 1024 PNG.
- Dark navbar: `franwallet-nav.svg`, 44 × 37 CSS pixels (40 × 34 on mobile).
- Square logo with subtle name: `franwallet-logo.svg` / PNG. Lettering is outlined actual Fraunces, so it does not depend on a locally installed font.
- Wordmark and horizontal lockups: supplied SVGs. Reverse lockup is for dark backgrounds. Tagline is optional; retain the site's existing wording.
- Social sharing: `franwallet-social-1200x630.svg` / PNG and square SVG / PNG.
- Website font sources, licenses and smaller icon sizes: `/assets/brand/`.

Do not use the rejected outline wallet, diagonal cut or retired F tile for new work. Do not put tiny lettering in 16 / 32 pixel favicons; use the icon-only master there.

Social SVGs contain real font outlines. To rebuild them: install `fonttools` and `uharfbuzz` in an isolated Python environment, then run `python marketing/brand/build-social.py`. Render SVGs to PNG using a standards-compliant SVG renderer such as Resvg. Website pages are maintained with `npm run build`; it reapplies shared brand metadata automatically. Run `npm test` and `npm run check:public` before publishing.

The new-owner movie keeps its original 60.8-second duration, 30 fps, narrative and silent soundtrack. Only recognized old Fran identity tiles were replaced. Product screenshots show actual site components with synthetic public sample data; they contain no customer records. Historical review recordings and earlier campaign proofs remain archives.
