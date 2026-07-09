# FactLens Slide Deck (GitHub Pages)

This repository contains:

- `viewer.html`
- `slide-01.html` ~ `slide-11.html`
- `assets/` (CSS, SVG, fonts, images)

## 로컬 확인

```bash
python -m http.server 4173
```

Open `http://localhost:4173/`.

## GitHub Pages 배포(정적 파일)

```bash
git add .
git commit -m "Add FactLens slide deck"
git branch -M main
git remote add origin https://github.com/<your-org-or-user>/<repo>.git
git push -u origin main
```

GitHub Settings > Pages:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

배포 URL:

`https://<your-org-or-user>.github.io/<repo>/`
