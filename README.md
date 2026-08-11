# portfolio-content

Repositorio de contenido/datos para el portafolio personal de Dario Herrera. Sin código de aplicación de UI, sin tests — solo contenido y un pequeño script de Node que un frontend de portafolio separado consume.

## Contenido

- `content/en.json` / `content/es.json` — Textos de la UI en inglés y español.
- `content/portfolio.json` — Datos estructurados independientes del idioma (info personal, experiencia, proyectos, cursos, skills).
- `content/tech-news.json` — Feed de novedades de tecnología (IA, nube, frontend, mobile, backend, lenguajes, herramientas), con imagen de portada cuando está disponible. Se regenera automáticamente todos los días vía GitHub Action (`.github/workflows/tech-news.yml`), que corre `npm run fetch:tech-news` → `scripts/fetch-tech-news.mjs` y commitea el resultado. **No editar a mano: el Action lo sobrescribe.**
- `content/assets/cv.pdf`, `content/assets/photo.png` — CV y foto de perfil, referenciados por URL (raw.githubusercontent.com) desde `portfolio.json`.

Ver `CLAUDE.md` para detalles sobre cómo se referencian estos archivos entre sí.

## Actualizar el feed de tecnología manualmente

```bash
npm install
npm run fetch:tech-news
```

O dispara el workflow a mano desde la pestaña Actions de GitHub (`workflow_dispatch`).
