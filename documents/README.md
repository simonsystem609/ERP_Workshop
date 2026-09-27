# Local demo documents

This directory belongs to the **localhost demo profile**, not the production
ERP. Put only synthetic or otherwise publishable files here. The bundled
`demo-bom.csv` is a two-row placeholder BOM.

The demo's server browser and linked-document routes are confined to this
directory. The Office filter shows Office, OpenDocument, and PDF files while
keeping folders visible. Material, tool, and fastener requests can link one of
those files; the source file is not copied. The BOM form can link CSV, TXT, or
XLSX files here, or upload one into this profile's `.demo-data/uploads` folder.
The simple BOM parser reads the first worksheet of an XLSX or delimited text,
up to 5,000 rows and 20 MB; it is not a full Excel calculation engine.

Changing a profile's `config.json` does not copy this directory. Create a
separate `documents` folder beside each profile config if file demos are
needed. Paths outside that folder and symlink/junction escapes are rejected.
Do not point a profile at Y: or a network share.

## Project browser folders

Each existing demo project may have a local folder at
`documents/projects/<SHA-256 of project ID in UTF-8, lowercase hex>`. Open
that project in the in-app project browser to see its exact relative folder.
For example, `demo-project-a` uses the folder produced by
`node -e "console.log(require('node:crypto').createHash('sha256').update('demo-project-a').digest('hex'))"`.
Create that folder manually and place only synthetic or publishable files
inside it. No folder is made automatically and no new ERP project is inferred
from a file. The browser lists `.slddrw`, `.drw`, `.dwg`, `.dxf`, `.sldasm`,
`.sldprt`, `.step`, `.stp`, `.iges`, `.igs`, and `.pdf` through eight levels,
up to 500 files/1,000 folders. It refuses redirected roots and skips redirected
children. The demo offers PDF inline viewing, file download, and relative-path
copying; it does not launch local CAD software or use the production Helper.

This public demo includes one minimal, synthetic `synthetic-line.dxf` in the
hashed `demo-project-a` folder. It contains a single line and no customer
geometry. To see it from a separate local profile, copy that file into the
same hashed path below that profile's own `documents/` directory.
