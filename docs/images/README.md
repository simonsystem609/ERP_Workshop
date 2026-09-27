# English demo screenshots

The PNGs in this folder were captured from the synthetic localhost demo with
`node tests/browser-smoke.mjs --check-viewer --check-english`. They show desktop dashboard,
material requests, worklog, finance, projects, local settings, 3D model list,
the synthetic GLB viewer, the local modelling-photo page, and mobile material
requests. Do not add screenshots
from the live company ERP or from the private profile. The browser test will
not overwrite existing images unless `--refresh-screenshots` is passed after
a separate backup. On 2026-09-26 the previous ten PNGs were hash-verified
under `<private-backup-root>\20260926-213127-demo-screenshots-before`, then
all were refreshed from the current persistent 25-menu generic demo. The
dashboard now says changes persist locally instead of the older reset claim.

On 2026-09-27, all 39 PNGs were SHA-256 matched to the C-only snapshot at
`<private-backup-root>\20260927-english-ui-before`, then moved individually
to its `original-images-moved` folder without deletion. The browser test
created new English screenshots in non-overwriting mode. The 25 menu views,
four read-only function views, and ten top-level desktop/mobile views passed
the English-label audit and rendered the synthetic GLB. The prior captures
remain recoverable in that backup. On 2026-09-27, the user reviewed this
English gallery and confirmed the images are good. This approval applies to
the current 39 PNGs; recapture or image edits require another visual review.

## Full synthetic localhost gallery

The following 25 menu captures and four read-only function captures were
recaptured in English on 2026-09-27 with `node tests/browser-smoke.mjs
--check-viewer --check-english --capture-all-menus` against the ignored profile at
`<demo-root>\.demo-data\synthetic-screenshot-profile-20260927`. That profile was
seeded only from `config.example.json`, the generic logo, synthetic GLB/JSON,
sample CSV, and the synthetic project DXF. The browser test did not submit
records or overwrite any PNG.

1. [Home](menus/01-dashboard.png)
2. [Project overview](menus/02-project-view.png)
3. [CNC summary](menus/03-cnc-summary.png)
4. [Tasks](menus/04-todos.png)
5. [CNC machining](menus/05-cnc.png)
6. [Tool requests](menus/06-tools.png)
7. [Material requests](menus/07-materials.png)
8. [Fastener requests](menus/08-fasteners.png)
9. [Work log](menus/09-worklog.png)
10. [BOM](menus/10-bom.png)
11. [3D models](menus/11-cad-models.png)
12. [Suppliers](menus/12-suppliers.png)
13. [Project prices](menus/13-price-items.png)
14. [Project cost planning](menus/14-cost-planning.png)
15. [Outsourcing](menus/15-outsourcing.png)
16. [Production items](menus/16-production-items.png)
17. [Engineering / Design](menus/17-design.png)
18. [Quotes](menus/18-quotes.png)
19. [Engineering log](menus/19-engineering-notes.png)
20. [Production schedule](menus/20-production.png)
21. [Reports](menus/21-finance-reports.png)
22. [Project management](menus/22-projects.png)
23. [Parameters](menus/23-parameters.png)
24. [Settings](menus/24-stats.png)
25. [Archive](menus/25-archive.png)

Function examples: [fullscreen worklog](functions/worklog-fullscreen.png),
[project file browser with synthetic DXF](functions/project-browser.png),
[local modelling page](functions/modelling.png), and
[in-page GLB viewer with synthetic box](functions/model-viewer.png).
