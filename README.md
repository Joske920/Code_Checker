# CNC Programma Viewer & 3D Simulator

Een geavanceerde webapplicatie voor het bekijken, analyseren en simuleren van CNC programma's met real-time 3D visualisatie.

## Features

### 📁 Bestandsbeheer
- Browse door mappen en submappen
- Bekijk CNC programma's met regelnummers
- Zoek bestanden in de sidebar
- Kopieer code naar klembord
- Download bestanden
- Breadcrumb navigatie

### 🎮 3D Viewer & Simulator
- **Real-time 3D visualisatie** met Three.js
- **Interactieve camera** met orbit controls, pan en zoom
- **Tool bibliotheek** met multi-D variant ondersteuning
- **Radius compensatie** (G40/G41/G42) met visuele offset weergave
- **Stap-voor-stap animatie** met variabele snelheid
- **Siemens 840D ondersteuning**:
  - `AROT` - Axis rotation voor 5-assig bewerkingen
  - `TRANS` - Coordinate system translation
  - `TRAFOOF` - Transformation reset
- **Opdek/Fold visualisatie** - Automatische detectie van RFID parameters (fold_above, fold_left, fold_right)
- **IF/ENDIF conditionele logica** met variabele evaluatie
- **DEF variabelen** met type ondersteuning (REAL, INT, STRING, BOOL, CHAR, AXIS)

### 🔧 Tool Compensatie
- **G40** - Compensatie uit
- **G41** - Links van contour (counter-clockwise offset)
- **G42** - Rechts van contour (clockwise offset)
- **Directe G41↔G42 transitie** detectie
- **Corner compensation** voor hoeken
- **Arc compensation** voor bogen (G2/G3)
- **Z-only bewegingen** behouden gecompenseerde XY positie

### 📊 Deur Model Visualisatie
- Automatische RFID parameter parsing
- Opdek cut-out geometrie op basis van:
  - `fold_above` - Kop (X=length)
  - `fold_left` - Linker zijde (Y=0)
  - `fold_right` - Rechter zijde (Y=width)
- Foldheight berekening (25.5mm standaard)

### 🎬 Animatie & Opname
- Stap-voor-stap animatie met feedrate ondersteuning
- Video opname in MP4, AVI of GIF formaat
- Variabele animatie snelheid
- Pause/resume functionaliteit

## Installatie

1. Zorg dat Python 3.7+ geïnstalleerd is
2. Installeer de benodigde packages:
```bash
pip install -r requirements.txt
```

## Gebruik

1. Start de server:
```bash
python server.py
```

2. Open je browser en ga naar: `http://localhost:5000`

3. Browse door de CNC bestanden of open de 3D viewer met `tools.html`

## Configuratie

### CNC Directory
Om de CNC directory aan te passen, wijzig de `CNC_ROOT` variabele in `server.py`:

```python
CNC_ROOT = r'E:\Theuma_dev\cnc'
```

### Tool Library
Tools worden gedefinieerd in `tool-library.js` met parameters:
- `pl` - Program number
- `d` - Offset/diameter variant
- `type` - Tool type (endmill, ball, drill, etc.)
- `radius` - Tool radius in mm
- `length` - Tool length in mm
- `rotation` - Rotatie richting (CW/CCW)

### Viewer Settings
Camera en animatie instellingen zijn beschikbaar in de UI:
- Safe Z hoogte voor tool changes
- Max rapid feedrate (G0)
- Animatie snelheid
- Realistische speed mode

## Ondersteunde G-codes

### Basis Bewegingen
- `G0` - Rapid positioning (dashed lines)
- `G1` - Linear interpolation (solid green lines)
- `G2` - Clockwise arc
- `G3` - Counter-clockwise arc
- `G4` - Dwell/pause

### Coordinaat Systeem
- `G90` - Absolute programming
- `G91` - Incremental programming

### Tool Compensatie
- `G40` - Cancel cutter compensation
- `G41` - Cutter compensation left
- `G42` - Cutter compensation right

### Siemens 840D Specifiek
- `AROT X.. Y.. Z..` - Axis rotation
- `TRANS X.. Y.. Z..` - Translation/offset
- `TRAFOOF` - Reset all transformations
- `DEF <type> <var>=<value>` - Variable definition
- `IF <condition>` / `ENDIF` - Conditional blocks

### Tool Management
- `T<n>` - Tool selection
- `D<n>` - Offset selection

## Ondersteunde bestandsextensies

- .nc, .cnc, .mpf, .spf
- .txt, .tap, .prg
- .min, .h, .sub
- Bestanden zonder extensie

## Technische Details

### Frontend
- **Three.js** - 3D rendering engine
- **Vanilla JavaScript** - Geen framework dependencies
- **CSS Grid/Flexbox** - Responsive layout

### Backend
- **Flask** - Python web framework
- **Werkzeug** - WSGI utilities
- **JSON API** - RESTful endpoints

### Coordinate System Mapping
```
CNC Coordinate System → Three.js World Space
X (length)    → X
Y (width)     → -Z
Z (height)    → Y
```

## Browser Compatibiliteit

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

WebGL en ES6 support vereist.

## Licentie

Proprietary - Cobus NC Programs

## Changelog

### v2.0 (December 2025)
- ✅ AROT command fix - rotatie hoeken niet meer als posities geparsed
- ✅ Z-only beweging fix - tool behoudt gecompenseerde XY positie
- ✅ IF/ENDIF conditionele logica met operator ondersteuning
- ✅ Opdek/fold visualisatie vanuit RFID parameters
- ✅ G41↔G42 directe transitie detectie

### v1.0
- Initial release met basis 3D viewer
- File browser en code viewer
- Tool library en compensatie
