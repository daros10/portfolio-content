# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Propósito del repositorio

Este es un repositorio puramente de contenido/datos para el portafolio personal de Dario Herrera. No contiene código de aplicación, herramientas de build, tests ni dependencias — solo tres archivos JSON mantenidos a mano que un frontend de portafolio separado (que no está en este repo) consume para renderizar el texto de la UI y los datos estructurados.

## Archivos

- `content/en.json` / `content/es.json` — Textos de la UI (labels de navegación, títulos de sección, descripciones, textos de formularios) en inglés y español. Ambos archivos comparten **la misma estructura de claves**; al agregar, renombrar o eliminar una clave en uno, hay que hacer el mismo cambio en el otro.
- `content/portfolio.json` — Datos estructurados, independientes del idioma: información personal, experiencia laboral, proyectos, cursos y categorías de habilidades (con URLs de íconos de los CDNs de devicon/jsdelivr y huggingface).

## Referencias cruzadas entre archivos (la parte que no es obvia con solo mirar un archivo)

`portfolio.json` y los dos archivos de idioma están vinculados mediante claves de texto, no mediante IDs compartidos ni un schema — nada fuerza estos vínculos automáticamente, así que hay que mantenerlos sincronizados a mano:

- Cada entrada en `experiences[]` de `portfolio.json` tiene un `tasksKey` (p. ej. `"datafastTask"`) que nombra un objeto de nivel superior en `en.json`/`es.json`. Las claves de ese objeto (`"A"`, `"B"`, `"C"`, ...) deben coincidir exactamente con las que aparecen en el array `taskKeys` de esa experiencia. Agregar una tarea implica agregar una letra a `taskKeys` en `portfolio.json` y la entrada correspondiente `"A": "..."` (en ambos idiomas) dentro de ese objeto `*Task`.
- Cada proyecto en `professionalProjects[]` / `personalProjects[]` tiene un `descriptionKey` con el formato `"projectDescriptions.<key>"`, que apunta al objeto `projectDescriptions` en `en.json`/`es.json`. Esa `<key>` debe existir ahí en ambos archivos de idioma.
- Cada entrada en `skillCategories[]` tiene un `key` (p. ej. `"ai"`, `"mobile"`, `"frontend"`, `"backend"`, `"tools"`) que debe coincidir con una clave bajo `skills` en `en.json`/`es.json` (usada como título de esa categoría).

Al editar contenido, verifica la integridad referencial entre los tres archivos en lugar de editar uno de forma aislada — p. ej. si agregas una nueva experiencia, proyecto o categoría de habilidad, agrega las claves correspondientes en ambos `en.json` y `es.json`.

## Trabajando con estos archivos

- No hay comando de build, lint ni test — valida los cambios confirmando que el JSON parsea correctamente (p. ej. `python3 -m json.tool content/en.json`) y que las referencias cruzadas de claves descritas arriba siguen cuadrando.
- Mantén `en.json` y `es.json` estructuralmente idénticos (mismas claves, mismo anidamiento) — solo los valores deberían diferir entre idiomas.
