"use strict";

// English presentation for the standalone localhost demo. This deliberately
// changes labels, not record values, API field names, or the guarded backend.
(() => {
  if (!globalThis.ERP_DEMO_CONFIG) return;

  const labels = new Map(`
Kezdőképernyő|Home
Közös teendők, megbeszélések és kiemelt projektek.|Shared tasks, meetings and highlighted projects.
Projekt nézet|Project overview
Aktív projektek prioritás és frissesség szerint.|Active projects by priority and recent activity.
CNC összesítő|CNC summary
Gépenkénti CNC feladatlista és aktuális munka.|CNC tasks and current work by machine.
Feladatok|Tasks
Munkafolyamatok és projektfájlok.|Tasks and project files.
CNC megmunkálás|CNC machining
Gyártási feladatok, gépek és időablakok.|Production tasks, machines and time slots.
Szerszámigények|Tool requests
Maró-, fúró- és egyéb szerszámkérések.|Requests for cutters, drills and other tools.
Anyagigények|Material requests
Beszerzendő alapanyagok és méretek.|Materials and dimensions to purchase.
Kötőelem igények|Fastener requests
Csavarok, anyák, alátétek és egyéb kötőelemek igényei.|Requests for bolts, nuts, washers and other fasteners.
Munkaidő napló|Work log
Munkaórák rögzítése projektekhez.|Record work hours against projects.
Darabjegyzékek linkelése, feltöltése és importja.|Link, upload and import bills of materials.
3D modellek|3D models
A Helperből exportált GLB modellek megtekintése és projekthez kapcsolása.|View exported GLB models and link them to projects.
Beszállítók|Suppliers
Védett pénzügyi és mérnökségi törzsadatok.|Protected finance and engineering reference data.
Projekt árak|Project prices
Projektbeszerzések, darabárak és státuszok.|Project purchases, unit prices and statuses.
Projekt költségtervezés|Project cost planning
Terv és tény költségek projekt és kategória szerint.|Planned and actual costs by project and category.
Bérmunka / külső műveletek|Outsourcing / external operations
Kiadott külső munkák, várható visszaérkezés és tényköltség.|External jobs, expected returns and actual costs.
Gyártási feladatok|Production items
Belső és külső gyártási műveletek órával, határidővel és státusszal.|Internal and external production operations, hours, deadlines and status.
Mérnöki / Tervezés|Engineering / Design
CAD/CAM, villamos és PLC tervezési tételek dokumentumállapottal.|CAD/CAM, electrical and PLC design items with document status.
Ajánlatok|Quotes
Beszállítói ajánlatok, érvényesség és projektköltség előkészítés.|Supplier quotes, validity and project cost preparation.
Mérnöki napló|Engineering log
Projekt döntések, kockázatok és műszaki változások.|Project decisions, risks and technical changes.
Gyártás ütemezés|Production schedule
CNC gépek napi terhelése és szabad idősávjai.|Daily CNC machine load and available time slots.
Riportok|Reports
Projekt riport|Project report
Projektköltségek és negyedéves összesítők.|Project costs and quarterly summaries.
Projektek kezelése|Project management
Aktiválás, lezárás és prioritás.|Activation, closure and priority.
Paraméterek|Parameters
Anyag-, anyagtípus- és pénzügyi/mérnökségi törzslisták.|Materials, material types, and finance/engineering reference lists.
Beállítások|Settings
Bejelentkezés|Sign in
Válassz felhasználót, majd add meg a személyes jelszót.|Select a user and enter your password.
Védett mód|Protected mode
Helyi admin beállítása|Set up local administrator
Ez az egyszeri beállítás csak a helyi demó profilt védi. Külső eléréshez további telepítési és adatbiztonsági lépések szükségesek.|This one-time setup protects only the local demo profile. External access requires additional deployment and security work.
Első admin:|First administrator:
Nincs beállított admin|No administrator configured
Új jelszó (legalább 14 karakter)|New password (at least 14 characters)
Jelszó újra|Repeat password
Admin beállítása|Set up administrator
Jelszó|Password
Belépés|Sign in
Jelszó megjelenítése|Show password
Éves jelszócsere ajánlott|Annual password change recommended
Éves jelszócsere ajánlott. Belépés után a Beállításokban változtasd meg a jelszavad.|Annual password change recommended. Change your password in Settings after signing in.
Személyes jelszó|Personal password
Jelenlegi személyes jelszó|Current password
Új személyes jelszó|New password
Új jelszó újra|Repeat new password
Személyes jelszó mentése|Save password
Helyi projektmappa-szkennelés:|Local project-folder scan:
Helyi projektmappák frissítése|Refresh local project folders
A helyi jelszavas mód aktív.|Local password mode is active.
A jelszavak csak ebben a helyi demó adatbázisban vannak.|Passwords are stored only in this local demo database.
Helyi rajzszám-/projekt OCR:|Local drawing/project OCR:
Tesseract engedélyezve|Tesseract enabled
nincs beállítva|not configured
A helyi admin beállítva.|Local administrator set up.
Belépve.|Signed in.
Személyes jelszó frissítve.|Personal password updated.
Mappák, jelszavak és felhasználók.|Folders, passwords and users.
Archivált|Archive
ERP-ből törölt projektek megőrzött adatai.|Retained data from archived ERP projects.
Pénzügy / mérnökség|Finance / Engineering
Vezérlőpult|Dashboard
Kapcsolódás...|Connecting...
Személyes teendők|Personal tasks
Frissítés|Refresh
Kilépés|Sign out
Figyelmeztetések ▾|Alerts ▾
Még nincs figyelmeztetés.|No alerts yet.
Mind olvasott|Mark all read
Projektváltozások|Project changes
Nincs találat.|No results.
— nincs —|— none —
Keresés|Search
Hozzáadás|Add
Mentés|Save
Módosítás|Edit
Módosítás mentése|Save changes
Mégse|Cancel
Szerkesztés|Edit
Törlés|Delete
Eltávolítás|Remove
Bezárás|Close
Megnyitás|Open
Letöltés|Download
Feltöltés|Upload
FELTÖLTÉS|UPLOAD
Tallózás|Browse
Szerver tallózás|Browse server
Drop ablak|Drop window
Fájl választása|Choose file
FÁJL|FILE
Útvonal linkelése|Link path
Útvonal|Path
Mappa útvonal|Folder path
Forrás|Source
Név|Name
Megnevezés|Description
Leírás|Description
Megjegyzés|Note
Tárgy|Subject
Dátum|Date
Kategória|Category
Kategóriák|Categories
Státusz|Status
Státuszok|Statuses
Állapot|State
Típus|Type
Művelet|Operation
Mennyiség|Quantity
Darabszám|Quantity
db|pcs
Egység|Unit
Egységár|Unit price
Összeg|Amount
Összesen|Total
Szint|Level
Projekt|Project
Projektek|Projects
Projekt neve|Project name
Projekt név vagy útvonal|Project name or path
Projekt név, útvonal vagy forrás|Project name, path or source
Projekt szűrő|Project filter
Projekt választás|Choose a project
Projekt vagy bármely szöveg|Project or any text
Összes projekt|All projects
Aktív projektek|Active projects
Aktív projektek listája|Active project list
Projekt hozzáadása|Add project
Mappák frissítése|Refresh folders
Projekt böngésző|Project browser
Rajzok, összeállítások és PDF-ek a helyi demó projektmappából.|Drawings, assemblies and PDFs from the local demo project folder.
Projekt mappa neve|Project folder name
Projekt hozzárendelése|Assign project
ERP projekt:|ERP project:
ERP-ben létrehozott projekt|Project created in ERP
kézi projekt|manual project
nincs hozzárendelve|unassigned
Előbb tedd inaktívvá a projektet|Deactivate the project first
Aktív|Active
aktív|active
Archiválás|Archive
Lezárás|Close project
Prioritás|Priority
PRIO:|PRIORITY:
Magas Normál Alacsony|High Normal Low
Felelős|Assignee
Felelősök|Assignees
Felelős választása|Choose an assignee
Felelős keresés|Search assignees
Felelős szűrő|Assignee filter
Felelős / rögzítő szűrő|Assignee / logger filter
Minden felelős|All assignees
Minden felelős / rögzítő|All assignees / loggers
Nincs felelős|No assignee
Felhasználó|User
Ki|Who
Demó felhasználók|Demo users
Aktív demó felhasználó|Active demo user
Új teendő vagy kép leírása|Describe a new task or image
Általános teendők|General tasks
Megbeszélés|Meeting
Megbeszélések|Meetings
Határidő|Deadline
Nincs határidő|No deadline
Kezdés|Start
Befejezés|Finish
Kezdő nap|First day
Utolsó nap|Last day
üresen: egy nap|blank: one day
Szabadnap|Day off
Az "Utolsó nap" üresen hagyva egynapos szabadság. A bejegyzés a dátum elteltével automatikusan törlődik.|Leave "Last day" blank for one day off. The entry is automatically removed after the date passes.
Közös|Shared
Munkafolyamat|Task
Munkafolyamat hozzáadása|Add task
Munkafolyamat mentése|Save task
Feladat|Task
feladat|task
CNC feladatok|CNC tasks
CNC feladat mentése|Save CNC task
CNC gép|CNC machine
CNC gép választása|Choose a CNC machine
CNC gép neve|CNC machine name
CNC gép hozzáadása|Add CNC machine
Gépek / munkahelyek|Machines / workstations
Gép/Munkahely|Machine / workstation
Munka / CNC gép|Work / CNC machine
Nincs további nyitott feladat ezen a gépen.|No further open tasks on this machine.
Lejelentés|Report completion
Nem foglalt időablak|Available time slot
Szabad|Available
Anyag|Material
anyag|material
Anyagok|Materials
Anyagtípusok|Material types
Anyaghosszak|Material lengths
Hossz|Length
Méret|Size
nyers és/vagy kész méret|raw and/or finished size
pl. 6000 mm|e.g. 6000 mm
Átmérő jel (Ø) beszúrása|Insert diameter symbol (Ø)
Előgyártmány szállítás|Prefabricated item transport
Előgyártmány feladat típusok|Prefabricated task types
hidegen húzott rúd|cold-drawn bar
Darabjegyzék|Bill of materials
BOM-ok|BOMs
BOM hozzáadása|Add BOM
BOM név|BOM name
BOM mentése és import|Save and import BOM
Nincs aktív projekthez tartozó BOM.|No BOM for an active project.
Nincs BOM link kiválasztva.|No BOM link selected.
Linkelt Excel / CSV útvonal|Linked Excel / CSV path
A helyi profil documents mappájában lévő BOM fájl.|BOM file in the local profile's documents folder.
Excel/CSV másolása a külön helyi demó feltöltések közé, importálással együtt.|Copy Excel/CSV into the local demo uploads and import it.
Új anyagigény|New material request
Anyagigény módosítása|Edit material request
Anyagigény mentése|Save material request
Új szerszámigény|New tool request
Szerszámigény módosítása|Edit tool request
Új kötőelem igény|New fastener request
Kötőelem igény módosítása|Edit fastener request
Kötőelem igény mentése|Save fastener request
Igény mentése|Save request
Szerszám|Tool
szerszám|tool
Szerszám neve|Tool name
Szerszámnevek|Tool names
Kötőelem típusok|Fastener types
Kötőelem anyagok|Fastener grades / materials
Kötőelem méretek|Fastener sizes
Szilárdság / anyag|Strength / material
Csavar|Bolt
csavar|bolt
imbusz csavar|socket-head bolt
Helyi dokumentum: Office / PDF link|Local document: Office / PDF link
HELYI LINK|LOCAL LINK
SZERVER LINK|SERVER LINK
LINK|LINK
Nincs melléklet kiválasztva.|No attachment selected.
Nincs csatolmány kiválasztva.|No attachment selected.
Nincs fájl kiválasztva.|No file selected.
Nincs beillesztett kép.|No pasted image.
Újra, új bejegyzésként|Repeat as new entry
Munkaidő rögzítése|Log work time
Munka típusa|Work type
Munka típusok|Work types
Idő|Duration
Óra|Hours
óra|hours
óra (pl. 1.5)|hours (e.g. 1.5)
Óra növelése|Increase hours
Óra csökkentése|Decrease hours
Túlóra|Overtime
Napló|Log
Naplózás|Log time
Legutóbbi naplózások|Recent work logs
Legutóbbi naplózások teljes képernyőn|Recent work logs full screen
⛶ Teljes képernyő|⛶ Full screen
Projekt vagy felhasználó kiválasztásakor csak a hozzá tartozó sorok látszanak.|Select a project or user to show only their entries.
Válassz projektet|Choose a project
Válassz projektet a Cég adat megjelenítéséhez.|Choose a project to show its company.
Naplózás mentése|Save work log
Terv óra|Planned hours
Tény óra|Actual hours
Költség összesítő Ft|Cost summary HUF
Terv Ft|Planned HUF
Tény Ft|Actual HUF
Eltérés Ft|Difference HUF
Költségtételek|Cost items
Nincs költségtétel.|No cost item.
Nincs rögzített költségtétel.|No recorded cost item.
Válassz ki egy projektet, és utána tudsz költségtételeket felvinni hozzá.|Choose a project before adding cost items.
Itt külön projektre bontva lehet terv és tény költségeket felvinni és követni.|Track planned and actual costs by project here.
Ár tételek|Price items
ár tétel|price item
Projekt ár / beszerzés|Project price / purchase
Alkatrész|Part
Alkatrész, anyag, szolgáltatás|Part, material, service
Alkatrész, szolgáltatás vagy művelet|Part, service or operation
Tétel|Item
Új tétel|New item
Tétel mentése|Save item
Kiadás|Expense
Kiadva|Issued
Beszállító|Supplier
beszállító|supplier
Beszállító hozzáadása|Add supplier
Beszállító mentése|Save supplier
Beszállító neve|Supplier name
Kapcsolattartó|Contact person
Telefon|Phone
Érvényes eddig|Valid until
Ajánlat rögzítése|Add quote
Ajánlat mentése|Save quote
ajánlati összeg|quote amount
Bérmunka műveletek|Outsourcing operations
Bérmunka státuszok|Outsourcing statuses
bérmunka tétel|outsourcing item
Külsős cégek|External companies
Tényleges költség Ft|Actual cost HUF
Vissza várható|Expected return
Tervezett kezdés|Planned start
Tervezett befejezés|Planned finish
Gyártási műveletek|Production operations
Gyártási prioritások|Production priorities
Gyártási státuszok|Production statuses
Gyártási típusok|Production types
gyártási feladat|production task
Terület|Area
Tervezési státuszok|Design statuses
Tervezési területek|Design areas
tervezési tétel|design item
Mérnöki típusok|Engineering types
Mérnöki státuszok|Engineering statuses
Mérnöki bejegyzés|Engineering entry
nyitott mérnöki pont|open engineering item
nyitott|open
Döntés, kockázat, változás|Decision, risk, change
Műszaki részlet, döntés oka, következő lépés|Technical detail, reason for decision, next step
Következő lépés|Next step
Kategória összesítő|Category summary
Negyedév|Quarter
Negyedévek|Quarters
Év|Year
Pénznem|Currency
Pénznemek|Currencies
Paraméterek mentése|Save parameters
Ajánlat státuszok|Quote statuses
Költség kategóriák|Cost categories
Modelling mód|Modelling mode
Modelling fotók|Modelling photos
Fotófeltöltő megnyitása|Open photo uploader
Fotó feltöltés|Upload photos
Fotók készítése / kiválasztása|Take / select photos
Mobil fotó|Mobile photo
Még nincs fotó. A fenti gombbal fotózhatsz vagy választhatsz a galériából.|No photos yet. Use the button above to take or select photos.
Fotózz a telefonnal, add meg a projekt mappát, majd töltsd fel.|Take photos on your phone, enter a project folder, then upload.
Feltöltés (0 fotó)|Upload (0 photos)
A fotók ide kerülnek:|Photos are saved here:
.demo-data/modelling/<mappa> (csak helyi demó)|.demo-data/modelling/<folder> (local demo only)
Próbáld ki a külön fotófeltöltő felületet. A fájlok kizárólag ennek a demó profilnak a helyi|Try the separate photo uploader. Files stay inside this demo profile's local
mappájába kerülnek.|folder.
Vissza a demóba|Back to demo
Helyi demó beállítások|Local demo settings
Demó felhasználók|Demo users
Aktív demó felhasználó|Active demo user
Az alkalmazás csak ezen a gépen, a|This app listens only on this PC at
címen hallgat. Nincs aktív Cloudflare tunnel vagy watchdog. A helyi projektmappa-szkennelés ki van kapcsolva. Nincs jelszavas belépés.|. No Cloudflare tunnel or watchdog is active. Local project-folder scanning is off. Password login is off.
címen hallgat. Nincs aktív Cloudflare tunnel vagy watchdog. A helyi projektmappa-szkennelés ki van kapcsolva. A helyi jelszavas mód aktív.|. No Cloudflare tunnel or watchdog is active. Local project-folder scanning is off. Local password mode is active.
Megosztott vagy internetes használat előtt külön biztonságos telepítés, mentés és megosztott tárolási védelem szükséges. A demó felhasználónevei csak megjelenítési adatok.|Shared or internet access needs separate secure setup, backups and shared-storage protection. Demo usernames are display data only.
Megosztott vagy internetes használat előtt külön biztonságos telepítés, mentés és megosztott tárolási védelem szükséges. A jelszavak csak ebben a helyi demó adatbázisban vannak.|Shared or internet access needs separate secure setup, backups and shared-storage protection. Passwords are stored only in this local demo database.
A név, mintaadatok, katalógusok és felhasználók kezdeti értékei a demó|Initial names, sample records, catalogs and users are set in the demo
fájljában állíthatók. A már létrejött adatok a külön helyi SQLite adatbázisban maradnak:|file. Existing records remain in the separate local SQLite database:
Helyi rajzszám-/projekt OCR: nincs beállítva. Az OCR nem küld képet külső szolgáltatóhoz.|Local drawing/project OCR: not configured. OCR sends no image to an external service.
Helyi minta-importok: imports/cadmodels|Local sample imports: imports/cadmodels
A kész GLB/JSON pár helyi importként jelenik meg. A minta nem hoz létre és nem rendel hozzá projektet automatikusan.|A ready GLB/JSON pair appears as a local import. The sample does not create or assign a project automatically.
A megjelenítő igény szerint töltődik be.|The viewer loads only when requested.
3D modell|3D model
3D modell megjelenítő|3D model viewer
3D megnyitás|Open 3D model
Becenév|Nickname
Megjelenítő forrása és licence|Viewer source and license
Helper projektneve: Demo Project|Helper project name: Demo Project
ERP-ben létrehozott projekt|Project created in ERP
összeállítás|assembly
Összeállítások|Assemblies
Összesen|Total
összes fájl|all files
Rajz|Drawing
rajz|drawing
Rajzok|Drawings
Dokumentumok|Documents
PDF-ek|PDFs
Revízió|Revision
Utasítás|Instructions
Nincs megjegyzés.|No note.
Nincs archivált tétel.|No archived items.
Archivált ERP adatok|Archived ERP data
A helyi demó archív bejegyzései megmaradnak; visszaállíthatók, véglegesen nem törölhetők.|Local demo archive entries are retained; they can be restored but not permanently deleted.
Word-, Excel-, PowerPoint-, Visio-, Access-, Publisher-, OneNote-, OpenDocument- vagy PDF-fájl linkelhető. A demó csak a profil documents mappáját éri el.|You can link Word, Excel, PowerPoint, Visio, Access, Publisher, OneNote, OpenDocument or PDF files. The demo can access only the profile's documents folder.
documents/dokumentum.xlsx vagy .pdf|documents/document.xlsx or .pdf
pl. DEMO-050 minta|e.g. DEMO-050 sample
Opcionális|Optional
Opcionális — képeket is beilleszthetsz (Ctrl+V)|Optional — you can paste images too (Ctrl+V)
Nincs aktív projekthez tartozó BOM.|No BOM for an active project.
Nincs találat.|No results.
LOCAL-DEMO · helyi, ideiglenes demó|LOCAL DEMO · temporary local demo
Határidő: Nincs határidő|Deadline: None
Lista megnyitása|Open list
Y: tallózás a host gépen. Interneten is használható, ha a host látja a fájlt.|Browse files on the host. Remote access works only when the host can read the file.
Y: tallózás a host gépen.|Browse files on the host.
A PC-n futó helperrel fájl kiválasztás vagy natív drag-and-drop.|Choose files or use native drag-and-drop with the local Helper.
Helper app: fájl kiválasztás vagy natív drop.|Helper app: choose files or use native drop.
CNC megmunkálás hozzáadása|Add CNC machining task
8R1 50mm teljes hossz keményfém|8R1 50 mm full-length solid carbide
A / V1 / dátum|A / V1 / date
Összeállítás|Assembly
Nincs beszállító|No supplier
Nincs / később|None / later
Átlag készültség|Average completion
Bejegyzés mentése|Save entry
Pénzügyi XLSX|Finance XLSX
összes rögzített nettó|total recorded net
költség terv|cost plan
Egyéb|Other
Cég|Company
Cég:|Company:
Kész|Done
FE paraméterek|FE parameters
CNC-01 CNC-02 Külső|CNC-01 CNC-02 External
Belső Külső|Internal External
Új Folyamatban Kiadva Kész|New In progress Issued Done
Új Jóváhagyásra vár NC kiadva EPLAN kész Kiadva Kész|New Awaiting approval NC issued EPLAN ready Issued Done
Anyag Bérmunka Szerszám CNC Mérnöki Szállítás Egyéb|Material Outsourcing Tool CNC Engineering Shipping Other
Mechanika CAD CAD/CAM Villamos tervezés PLC Dokumentáció|Mechanical CAD CAD/CAM Electrical design PLC Documentation
Felhasználó neve|User name
Új érték|New value
Készültség %|Completion %
Ajánlat státusz|Quote status
Útvonal másolva.|Path copied.
Helyi dokumentum link kiválasztva.|Local document link selected.
Link hozzáadva a munkafolyamathoz.|Link added to task.
Fájl link kiválasztva.|File link selected.
BOM link kiválasztva.|BOM link selected.
Betöltve új bejegyzésként. Az eredeti változatlan.|Loaded as a new entry. The original is unchanged.
Betöltve új bejegyzésként.|Loaded as a new entry.
Nincs ilyen naplózás.|This work log does not exist.
Törölve.|Deleted.
Projekt archiválva.|Project archived.
Nincs jogosultság ehhez a menühöz.|You do not have permission for this menu.
Előbb jelentkezz be.|Sign in first.
A modell beceneve mentve.|Model nickname saved.
A modell projekt-hozzárendelése mentve.|Model project assignment saved.
A GLB és JSON már hiányzott; a sor eltűnt a listából.|The GLB and JSON were already missing; the row was removed from the list.
Szabadnap rögzítve.|Day off recorded.
Mentve.|Saved.
Megnyitva.|Opened.
Mappa megnyitva.|Folder opened.
Projekt kiválasztva:|Project selected:
Rajzszám beillesztve:|Drawing number inserted:
Nem talált olvasható szöveget. Próbálj közelebbi képet.|No readable text found. Try a closer photo.
Nem sikerült elindítani a kamerát.|Could not start the camera.
A kamera képe még nem áll készen.|The camera image is not ready yet.
Nem sikerült menteni a fotót.|Could not save the photo.
Nem sikerült a fotót előkészíteni.|Could not prepare the photo.
Egyszerre legfeljebb 20 fotó tölthető fel.|You can upload at most 20 photos at once.
Kép beillesztve. Írhatsz mellé leírást, majd Hozzáadás.|Image pasted. Add a description, then select Add.
Kép beillesztve a CNC feladathoz.|Image pasted into the CNC task.
Kép beillesztve a feladathoz.|Image pasted into the task.
Kép beillesztve az előgyártmány szállításhoz.|Image pasted into the prefabricated transport request.
Kép csatolva a feladathoz.|Image attached to the task.
Értesítési beállítások mentve.|Notification settings saved.
Ebben a böngészőben nem érhető el a kamera.|The camera is unavailable in this browser.
Az ERP telepített appként fut.|The ERP is running as an installed app.
Telepítés a böngésző menüjéből érhető el.|Installation is available from the browser menu.
ERP app telepítése elindult.|ERP app installation started.
Telepítés megszakítva.|Installation cancelled.
Értesítések bekapcsolva.|Notifications enabled.
Értesítések kikapcsolva ezen az eszközön.|Notifications disabled on this device.
Teszt értesítés elküldve.|Test notification sent.
`.trim().split("\n").map((line) => {
    const divider = line.indexOf("|");
    if (divider < 1) throw new Error(`Invalid English UI label: ${line}`);
    return [line.slice(0, divider), line.slice(divider + 1)];
  }));

  const dynamic = [
    [/^3D modellek \((\d+)\)$/g, "3D models ($1)"],
    [/^(.+) új jelszava$/g, "$1's new password"],
    [/^(.+) nyitott felelősségi tételei\.$/g, "$1's open assigned items."],
    [/(\d+) bejegyzés visszaállítva\. Az eredeti dátumok megmaradtak\./g, "$1 entries restored. Original dates were retained."],
    [/(\d+) modellfájl a helyi \.demo-data\/trash mappába került; (\d+) már hiányzott\. A sor eltűnt a listából\./g, "$1 model files moved to local .demo-data/trash; $2 were already missing. The row was removed."],
    [/A gyorsítótár a helyi \.demo-data\/trash mappába került\./g, "The cache was moved to local .demo-data/trash."],
    [/Eltávolítjuk a modellt a listából\? Az elérhető GLB és JSON fájlokat a helyi \.demo-data\/trash mappába mozgatjuk; a már hiányzó fájlok nem okoznak hibát\./g, "Remove this model from the list? Existing GLB and JSON files will move to local .demo-data/trash; missing files are ignored."],
    [/Tényleg törlöd\?/g, "Really delete?"],
    [/A művelet nem visszavonható\./g, "This action cannot be undone."],
    [/Biztosan archiválod ezt a projektet az ERP-ből\?/g, "Archive this project in the ERP?"],
    [/A projekt az ERP helyi archívumába kerül\. A demó dokumentumfájljai megmaradnak\./g, "The project moves to the local ERP archive. Demo document files are retained."],
    [/A\(z\) (\d+)\. prioritás már foglalt:/g, "Priority $1 is already assigned to:"],
    [/Átadod ezt a prioritást és átrendezed a többit\?/g, "Assign this priority here and reorder the others?"],
    [/(\d+) fotó feltöltve ide:/g, "$1 photos uploaded to:"],
    [/(\d+) fotó feltöltve, utána hiba:/g, "$1 photos uploaded, then an error occurred:"],
    [/Projekt kiválasztva:/g, "Project selected:"],
    [/Rajzszám beillesztve:/g, "Drawing number inserted:"],
    [/^Projekt böngésző\s*·/g, "Project browser ·"],
    [/^LOCAL-DEMO · helyi, ideiglenes demó/g, "LOCAL DEMO · temporary local demo"],
    [/Nincs beszállító/g, "No supplier"],
    [/Összeállítás/g, "Assembly"],
    [/\bfelelős:/gi, "assignee:"],
    [/\blétrehozta:/gi, "created by:"],
    [/\bTervezett:/g, "Planned:"],
    [/\bNincs felelős\b/g, "No assignee"],
    [/\bNincs határidő\b/g, "No deadline"],
    [/\b(\d+)\s+találat\b/g, "$1 results"],
    [/\b(\d+)\s+db\b/g, "$1 pcs"],
    [/\b(\d+)\s+fotó\b/g, "$1 photos"],
    [/\b(\d+)\s+óra\b/g, "$1 hours"],
    [/\bÖsszeállítás\b/g, "Assembly"],
    [/Élő beolvasás:/g, "Last scan:"],
    [/\bszkennelve:/g, "scanned:"],
    [/\bcsak helyi demó\b/g, "local demo only"]
  ];

  function translate(value) {
    const raw = String(value ?? "");
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    let english = labels.get(trimmed.replace(/\s+/g, " "));
    if (english === undefined) {
      english = trimmed;
      for (const [pattern, replacement] of dynamic) english = english.replace(pattern, replacement);
    }
    return english === trimmed ? raw : raw.replace(trimmed, english);
  }

  function translateDom() {
    const root = document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) continue;
      if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) parent.value = parent.textContent;
      const english = translate(node.nodeValue);
      if (english !== node.nodeValue) node.nodeValue = english;
    }
    for (const element of root.querySelectorAll("[placeholder], [title], [aria-label], [alt], input[type=button], input[type=submit], input[type=reset]")) {
      for (const name of ["placeholder", "title", "aria-label", "alt"]) {
        if (!element.hasAttribute(name)) continue;
        const original = element.getAttribute(name);
        const english = translate(original);
        if (english !== original) element.setAttribute(name, english);
      }
      if (element.matches("input[type=button], input[type=submit], input[type=reset]")) {
        const original = element.value;
        const english = translate(original);
        if (english !== original) element.value = english;
      }
    }
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; translateDom(); });
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label", "alt"]
  });
  const alertNative = window.alert.bind(window);
  const confirmNative = window.confirm.bind(window);
  const promptNative = window.prompt.bind(window);
  window.alert = (message) => alertNative(translate(message));
  window.confirm = (message) => confirmNative(translate(message));
  window.prompt = (message, initial) => promptNative(translate(message), initial);
  globalThis.ERP_ENGLISH_UI = { translate, refresh: schedule };
  schedule();
})();
