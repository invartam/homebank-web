# Icônes HomeBank Web et Electron

Créées le 15 novembre 2026 avec l’outil intégré `image_gen`, à partir de l’icône Aqua de HomeBank Panther. La banque à trois colonnes et la pièce dorée conservent l’identité commune ; les volumes et reflets sont simplifiés pour les interfaces actuelles.

- `homebank-modern.png` : master opaque, utilisé pour les icônes Web et les paquets Electron.
- `homebank-maskable.png` : variante avec un symbole plus petit sur un fond continu, prévue pour le masque d’installation de la PWA.

`npm run icons:generate` produit les PNG de `public/icons/` : favicons 16/32, Apple Touch 180, PWA 192/512, maskable 512 et fenêtre Electron 512. Les packages Electron génèrent leur icône 1024 avec une marge transparente et des coins arrondis, via `desktopIcon()` dans `scripts/icons.mjs`. Electron Builder l’utilise ensuite pour les formats natifs macOS/Windows/Linux. Le pipeline mobile réutilise aussi le master.

Les masters restent hors du dossier public. La génération des déclinaisons ne fait aucun appel à une API : elle utilise les images locales et Resvg, déjà présent dans le projet.

## Prompt de la déclinaison moderne

```text
Use case: style-transfer. Reference image: the HomeBank Panther bank-and-coin icon. Create ONE modern square app icon for HomeBank Web and Electron, clearly derived from this reference. Preserve the recognizable identity: a classical bank with three white columns and triangular roof, sapphire/aqua blue, and a small warm gold coin carrying a very simple embossed rising bar chart. Transform the 2003 glossy Aqua object into a contemporary, minimal premium-finance app mark: strong clean geometry, softly rounded edges, much simpler shapes, subtle restrained depth and tonal gradients, almost frontal view, excellent legibility at small sizes. Use a rich midnight-to-cobalt blue full-bleed opaque background reaching all four edges, without any external frame or rounded outer corners (the platform will apply its own mask). Center the bank and coin as one unified emblem, roughly 65 percent of the canvas width, generous uncluttered background margins. Three broad ivory columns; one simple cyan inset roof panel; small gold coin integrated with the lower right base. No fine architectural detail, no realistic glass reflections, no specular glare, no heavy shadow, no texture, no words, no letters, no watermark, no Apple logo, no mockup, no alternate views. One polished app icon, useful for Material, Fluent and current Apple interfaces, with the same visual identity as the supplied Panther icon.
```

## Prompt de la variante maskable

```text
Create a maskable PWA icon variant of this exact supplied image. Preserve the same bank, three ivory columns, cyan roof panel, gold coin, clean modern illustration style and deep blue background. Change only framing: scale the entire central bank-and-coin emblem down to 80 percent of its current size, centered, so ALL of the emblem including base corners fits comfortably inside the central circle of radius 38 percent of the canvas width. Naturally extend the same continuous rich dark blue background out to the image edges. The blue backdrop must be seamless and full bleed: absolutely no inset square, no panel, no inner frame, no visible boundary, no border, no outer rounded corners. One square app icon, no text, no mockups.
```
