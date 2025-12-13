import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const API_BASE = 'http://localhost:5000';

// Default tools library - each entry is a PL/D combination
let toolsLibrary = [
    {
        "pl": 1,
        "type": "Frees",
        "name": "1",
        "st": 1,
        "d": 1,
        "length": 208.61,
        "radius": 8.775,
        "width": 130,
        "teeth": 3,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 2,
        "type": "Frees",
        "name": "2",
        "st": 1,
        "d": 1,
        "length": 149,
        "radius": 6,
        "width": 60,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 3,
        "type": "Frees",
        "name": "3",
        "st": 1,
        "d": 1,
        "length": 242.08,
        "radius": 9,
        "width": 160,
        "teeth": 3,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 4,
        "type": "Frees",
        "name": "4",
        "st": 1,
        "d": 1,
        "length": 62.9,
        "radius": 79.55,
        "width": 4,
        "teeth": 16,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 4,
        "type": "Frees",
        "name": "4",
        "st": 1,
        "d": 2,
        "length": 110.4,
        "radius": 79.55,
        "width": 4,
        "teeth": 16,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 5,
        "type": "Frees",
        "name": "5",
        "st": 1,
        "d": 1,
        "length": 218,
        "radius": 7.97,
        "width": 130,
        "teeth": 3,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 6,
        "type": "Frees",
        "name": "6",
        "st": 1,
        "d": 1,
        "length": 66.9,
        "radius": 78.5,
        "width": 8,
        "teeth": 16,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 6,
        "type": "Frees",
        "name": "6",
        "st": 1,
        "d": 2,
        "length": 116.55,
        "radius": 78.5,
        "width": 8,
        "teeth": 16,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 7,
        "type": "Frees",
        "name": "7",
        "st": 1,
        "d": 1,
        "length": 131.163,
        "radius": 5.955,
        "width": 7,
        "teeth": 1,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 8,
        "type": "Frees",
        "name": "8",
        "st": 1,
        "d": 1,
        "length": 122.95,
        "radius": 79.9,
        "width": 12,
        "teeth": 4,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 8,
        "type": "Frees",
        "name": "8",
        "st": 1,
        "d": 2,
        "length": 65.95,
        "radius": 79.9,
        "width": 12,
        "teeth": 4,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 9,
        "type": "Frees",
        "name": "9",
        "st": 1,
        "d": 1,
        "length": 134.508,
        "radius": 5.79,
        "width": 7,
        "teeth": 1,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 10,
        "type": "Frees",
        "name": "10",
        "st": 1,
        "d": 1,
        "length": 122.5,
        "radius": 50,
        "width": 10,
        "teeth": 4,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 10,
        "type": "Frees",
        "name": "10",
        "st": 1,
        "d": 2,
        "length": 67.4,
        "radius": 50,
        "width": 10,
        "teeth": 4,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 11,
        "type": "Frees",
        "name": "11",
        "st": 1,
        "d": 1,
        "length": 269.27,
        "radius": 7.9,
        "width": 190,
        "teeth": 4,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 12,
        "type": "Frees",
        "name": "12",
        "st": 1,
        "d": 1,
        "length": 138.5,
        "radius": 50,
        "width": 30,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 12,
        "type": "Frees",
        "name": "12",
        "st": 1,
        "d": 2,
        "length": 79.4,
        "radius": 50,
        "width": 30,
        "teeth": 2,
        "rotation": "Links",
        "shape": "cylinder"
    },
    {
        "pl": 13,
        "type": "Boor",
        "name": "13",
        "st": 1,
        "d": 1,
        "length": 152,
        "radius": 3,
        "width": 118,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 14,
        "type": "Frees",
        "name": "14",
        "st": 1,
        "d": 1,
        "length": 159.426,
        "radius": 7,
        "width": 75,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 15,
        "type": "Boor",
        "name": "15",
        "st": 1,
        "d": 1,
        "length": 148.87,
        "radius": 5.975,
        "width": 118,
        "teeth": 4,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 16,
        "type": "Frees",
        "name": "16",
        "st": 1,
        "d": 1,
        "length": 151.293,
        "radius": 8,
        "width": 60,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    },
    {
        "pl": 30,
        "type": "Frees",
        "name": "Rondschaaf 50R",
        "st": 1,
        "d": 1,
        "length": 125,
        "radius": 34.5,
        "width": 54,
        "teeth": 4,
        "rotation": "Rechts",
        "shape": "roundshaper",
        "roundshaperRadius": 50
    },
    {
        "pl": 31,
        "type": "Frees",
        "name": "31",
        "st": 1,
        "d": 1,
        "length": 125,
        "radius": 50,
        "width": 30,
        "teeth": 2,
        "rotation": "Rechts",
        "shape": "cylinder"
    }
];

// Tool shape types
const toolShapes = [
    { value: 'cylinder', label: 'Frees' },
    { value: 'drill', label: 'Boor' },
    { value: 'ball', label: 'Balfrees' },
    { value: 'cone', label: 'Kegel (V-groeffrees)' },
    { value: 'chamfer', label: 'Afschuinfrees' },
    { value: 'roundshaper', label: 'Rondschaaf frees' }
];

// Rotation directions
const rotationDirections = ['Rechts', 'Links'];

// Load tools from localStorage
function loadTools() {
    const saved = localStorage.getItem('cncToolsLibrary');
    if (saved) {
        try {
            toolsLibrary = JSON.parse(saved);
            
            let needsSave = false;
            
            // Add default rotation if missing
            toolsLibrary.forEach(tool => {
                if (!tool.rotation) {
                    tool.rotation = 'Rechts'; // Default to right rotation
                    needsSave = true;
                    console.log(`Tool PL${tool.pl} D${tool.d} updated with default rotation 'Rechts'`);
                }
            });
            
            // Save back to localStorage if we added defaults
            if (needsSave) {
                saveTools();
                console.log('[loadTools] Updated localStorage with default rotation values');
            }
            
            console.log(`[loadTools] Loaded ${toolsLibrary.length} tools from localStorage`);
        } catch (e) {
            console.error('Error loading tools:', e);
        }
    } else {
        console.log('[loadTools] No saved tools, using defaults');
    }
    
    // Load custom shapes into toolShapes array
    loadCustomShapes();
}

function loadCustomShapes() {
    const saved = localStorage.getItem('customToolShapes');
    if (saved) {
        try {
            const customShapes = JSON.parse(saved);
            // Clear and rebuild toolShapes array
            toolShapes.length = 0;
            
            // Re-add built-in shapes
            toolShapes.push(
                { value: 'cylinder', label: 'Frees' },
                { value: 'drill', label: 'Boor' },
                { value: 'ball', label: 'Balfrees' },
                { value: 'cone', label: 'Kegel (V-groeffrees)' },
                { value: 'chamfer', label: 'Afschuinfrees' },
                { value: 'roundshaper', label: 'Rondschaaf frees' }
            );
            
            // Add custom shapes
            customShapes.forEach(shape => {
                toolShapes.push({
                    value: shape.value,
                    label: shape.label
                });
            });
            
            console.log(`Loaded ${customShapes.length} custom shapes into toolShapes`);
        } catch (e) {
            console.error('Error loading custom shapes:', e);
        }
    }
}

// Save tools to localStorage
function saveTools() {
    localStorage.setItem('cncToolsLibrary', JSON.stringify(toolsLibrary));
}

// Render tools table
function renderToolsTable() {
    const tbody = document.getElementById('toolsTableBody');
    if (!tbody) return; // Not on tools page
    tbody.innerHTML = '';

    // Sort by PL value
    const sortedTools = [...toolsLibrary].sort((a, b) => a.pl - b.pl);

    sortedTools.forEach((tool, displayIndex) => {
        // Find original index for data binding
        const originalIndex = toolsLibrary.findIndex(t => t === tool);
        const row = document.createElement('tr');
        
        row.innerHTML = `
            <td><input type="number" value="${tool.pl}" data-index="${originalIndex}" data-field="pl" class="tool-input" style="width: 60px;"></td>
            <td>
                <select data-index="${originalIndex}" data-field="type" class="tool-input" style="width: 100px;">
                    <option value="Frees" ${tool.type === 'Frees' ? 'selected' : ''}>Frees</option>
                    <option value="Boor" ${tool.type === 'Boor' ? 'selected' : ''}>Boor</option>
                    <option value="Balfrees" ${tool.type === 'Balfrees' ? 'selected' : ''}>Balfrees</option>
                </select>
            </td>
            <td><input type="text" value="${tool.name}" data-index="${originalIndex}" data-field="name" class="tool-input"></td>
            <td><input type="number" value="${tool.st}" data-index="${originalIndex}" data-field="st" class="tool-input" style="width: 60px;"></td>
            <td><input type="number" value="${tool.d}" data-index="${originalIndex}" data-field="d" class="tool-input" style="width: 60px;"></td>
            <td><input type="number" step="0.1" value="${tool.length}" data-index="${originalIndex}" data-field="length" class="tool-input" style="width: 80px;"></td>
            <td><input type="number" step="0.1" value="${tool.radius}" data-index="${originalIndex}" data-field="radius" class="tool-input" style="width: 80px;"></td>
            <td><input type="number" step="0.1" value="${tool.width}" data-index="${originalIndex}" data-field="width" class="tool-input" style="width: 80px;"></td>
            <td><input type="number" value="${tool.teeth || 0}" data-index="${originalIndex}" data-field="teeth" class="tool-input" style="width: 60px;"></td>
            <td>
                <select data-index="${originalIndex}" data-field="rotation" class="tool-input" style="width: 90px;">
                    <option value="Rechts" ${tool.rotation === 'Rechts' ? 'selected' : ''}>Rechts</option>
                    <option value="Links" ${tool.rotation === 'Links' ? 'selected' : ''}>Links</option>
                </select>
            </td>
            <td>
                <select data-index="${originalIndex}" data-field="shape" class="tool-input" style="width: 120px;">
                    ${toolShapes.map(shape => 
                        `<option value="${shape.value}" ${(tool.shape === shape.value || (!tool.shape && shape.value === 'cylinder')) ? 'selected' : ''}>${shape.label}</option>`
                    ).join('')}
                </select>
            </td>
            <td class="action-buttons">
                <button class="btn btn-small btn-secondary preview-btn" data-index="${originalIndex}">👁️</button>
                <button class="btn btn-small btn-danger delete-btn" data-index="${originalIndex}">🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Add event listeners
    document.querySelectorAll('.tool-input').forEach(input => {
        input.addEventListener('change', handleToolChange);
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteTool);
    });

    document.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', handlePreviewTool);
    });
}

// Handle tool field changes
function handleToolChange(e) {
    const index = parseInt(e.target.dataset.index);
    const field = e.target.dataset.field;
    const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;

    toolsLibrary[index][field] = value;
    saveTools();
}

// Handle delete tool
function handleDeleteTool(e) {
    const index = parseInt(e.target.dataset.index);
    if (confirm(`Weet je zeker dat je "${toolsLibrary[index].name}" wilt verwijderen?`)) {
        toolsLibrary.splice(index, 1);
        saveTools();
        renderToolsTable();
    }
}

// Handle add tool
function handleAddTool() {
    console.log('Adding new tool...');
    // Find highest PL number
    const maxPL = toolsLibrary.length > 0 
        ? Math.max(...toolsLibrary.map(t => t.pl)) 
        : 0;
    
    const newTool = {
        pl: maxPL + 1,
        type: 'Frees',
        name: 'Nieuw Gereedschap',
        st: 1,
        d: 1,
        length: 50,
        radius: 5,
        width: 12,
        teeth: 4,
        rotation: 'Rechts',
        shape: 'cylinder'
    };
    toolsLibrary.push(newTool);
    saveTools();
    renderToolsTable();
    console.log('Tool added:', newTool);
}

// Handle export
function handleExport() {
    const dataStr = JSON.stringify(toolsLibrary, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cnc-tools-library.json';
    link.click();
    URL.revokeObjectURL(url);
}

// Handle import
function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (Array.isArray(imported)) {
                    toolsLibrary = imported;
                    saveTools();
                    renderToolsTable();
                    alert('Tools succesvol geïmporteerd!');
                } else {
                    alert('Ongeldig bestandsformaat!');
                }
            } catch (err) {
                alert('Fout bij importeren: ' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// 3D Preview
let previewScene, previewCamera, previewRenderer, previewControls;
let currentPreviewIndex = -1;

function initPreview() {
    const container = document.getElementById('toolPreviewCanvas');
    if (!container) return; // Not on tools page
    
    // Scene
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x1a1a1a);

    // Camera
    previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    previewCamera.position.set(50, 50, 50);

    // Renderer
    previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    previewRenderer.setSize(268, 300);
    container.appendChild(previewRenderer.domElement);

    // Controls
    previewControls = new OrbitControls(previewCamera, previewRenderer.domElement);
    previewControls.enableDamping = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    previewScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    previewScene.add(directionalLight);

    // Grid
    const grid = new THREE.GridHelper(100, 10, 0x444444, 0x222222);
    previewScene.add(grid);

    animatePreview();
}

function animatePreview() {
    requestAnimationFrame(animatePreview);
    previewControls.update();
    previewRenderer.render(previewScene, previewCamera);
}

function createToolGeometry(tool, compensationMode = 'G40', isActive = true) {
    const group = new THREE.Group();
    const radius = tool.radius || 5;
    const diameter = radius * 2;
    const length = tool.length || 50;
    const width = tool.width || 0;
    
    // Ensure rotation property exists
    if (!tool.rotation) {
        console.warn(`[createToolGeometry] Tool PL${tool.pl} D${tool.d} missing rotation property, defaulting to 'Rechts'`);
        tool.rotation = 'Rechts';
    }
    
    // Determine color based on rotation direction
    let toolColor = 0xcccccc; // Default gray
    
    console.log(`[createToolGeometry] Creating PL${tool.pl || '?'} D${tool.d || '?'}: "${tool.name || 'unnamed'}" rotation="${tool.rotation}"`);
    
    if (tool.rotation === 'Links') {
        toolColor = 0x4444ff; // Blue
        console.log('[createToolGeometry] → Color: BLUE');
    } else if (tool.rotation === 'Rechts') {
        toolColor = 0xff4444; // Red
        console.log('[createToolGeometry] → Color: RED');
    } else {
        console.log(`[createToolGeometry] → Color: GRAY (rotation="${tool.rotation}" not recognized)`);
    }
    
    // Determine shape - use explicit shape property if set, otherwise default based on type
    let shape;
    if (tool.shape && tool.shape !== 'default') {
        shape = tool.shape;
    } else {
        // Default shapes based on type
        if (tool.type === 'Frees') shape = 'cylinder';
        else if (tool.type === 'Boor') shape = 'drill';
        else if (tool.type === 'Balfrees') shape = 'ball';
        else shape = 'cylinder'; // fallback
    }

    switch (shape) {
        case 'cylinder': // Frees
            // Cutting disc at origin (y=0) - this is the cutting point
            if (width > 0) {
                const discGeom = new THREE.CylinderGeometry(radius, radius, width, 16);
                const discMat = new THREE.MeshPhongMaterial({ color: toolColor });
                const disc = new THREE.Mesh(discGeom, discMat);
                disc.position.y = width / 2; // Bottom at y=0
                group.add(disc);
            }
            
            // Tool shaft extends upward from cutting disc
            const shaftGeom = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, length - width, 16);
            const shaftMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const shaft = new THREE.Mesh(shaftGeom, shaftMat);
            shaft.position.y = width + (length - width) / 2; // Above disc
            group.add(shaft);
            break;

        case 'drill': // Boor
            // Drill tip at origin (y=0)
            const drillTipGeom = new THREE.ConeGeometry(radius, length * 0.3, 16);
            const drillTipMat = new THREE.MeshPhongMaterial({ color: toolColor });
            const drillTip = new THREE.Mesh(drillTipGeom, drillTipMat);
            drillTip.position.y = length * 0.15; // Tip touches y=0
            drillTip.rotation.x = Math.PI; // Point down
            group.add(drillTip);

            // Drill body above tip
            const drillBodyGeom = new THREE.CylinderGeometry(radius, radius, length * 0.7, 16);
            const drillBodyMat = new THREE.MeshPhongMaterial({ color: toolColor });
            const drillBody = new THREE.Mesh(drillBodyGeom, drillBodyMat);
            drillBody.position.y = length * 0.3 + length * 0.35; // Above tip
            group.add(drillBody);
            break;

        case 'ball': // Balfrees
            // Ball tip at origin (y=0)
            const ballTipGeom = new THREE.SphereGeometry(radius, 16, 16);
            const ballTipMat = new THREE.MeshPhongMaterial({ color: toolColor });
            const ballTip = new THREE.Mesh(ballTipGeom, ballTipMat);
            ballTip.position.y = radius; // Bottom of ball at y=0
            group.add(ballTip);

            // Ball body above tip
            const ballBodyGeom = new THREE.CylinderGeometry(radius, radius, length - radius, 16);
            const ballBodyMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const ballBody = new THREE.Mesh(ballBodyGeom, ballBodyMat);
            ballBody.position.y = radius + (length - radius) / 2; // Above ball
            group.add(ballBody);
            break;

        case 'cone': // V-groeffrees
            // Cone tip at origin (y=0)
            const coneTipGeom = new THREE.ConeGeometry(radius, length * 0.5, 16);
            const coneTipMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
            const coneTip = new THREE.Mesh(coneTipGeom, coneTipMat);
            coneTip.position.y = length * 0.25; // Tip at y=0
            coneTip.rotation.x = Math.PI; // Point down
            group.add(coneTip);

            // Cone body above tip
            const coneBodyGeom = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, length * 0.5, 16);
            const coneBodyMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
            const coneBody = new THREE.Mesh(coneBodyGeom, coneBodyMat);
            coneBody.position.y = length * 0.5 + length * 0.25; // Above cone
            group.add(coneBody);
            break;

        case 'chamfer': // Afschuinfrees
            // Chamfer tip at origin (y=0)
            const chamTipGeom = new THREE.CylinderGeometry(radius, radius * 0.5, length * 0.3, 16);
            const chamTipMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
            const chamTip = new THREE.Mesh(chamTipGeom, chamTipMat);
            chamTip.position.y = length * 0.15; // Bottom at y=0
            group.add(chamTip);

            // Chamfer body above tip
            const chamBodyGeom = new THREE.CylinderGeometry(radius, radius, length * 0.7, 16);
            const chamBodyMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
            const chamBody = new THREE.Mesh(chamBodyGeom, chamBodyMat);
            chamBody.position.y = length * 0.3 + length * 0.35; // Above tip
            group.add(chamBody);
            break;

        case 'roundshaper': // Rondschaaf frees
            // Special tool: rounded profile cutter
            // Parameters:
            // - radius: narrow waist radius (default tool radius at center)
            // - width: cutting surface width (e.g., 54mm)
            // - tool.roundshaperRadius: large radius of cutting surface (e.g., 50mm)
            // Cutting point is at center of width (width/2 from bottom)
            
            const cutWidth = width || 54;
            const largeRadius = tool.roundshaperRadius || 50;
            const waistRadius = radius; // Narrowest point
            
            // Create torus-like cutting surface
            // Bottom cylinder (lower half of cutting area)
            const lowerCutGeom = new THREE.CylinderGeometry(
                waistRadius + (cutWidth * 0.25), // radius at bottom edge
                waistRadius, // radius at waist (center)
                cutWidth / 2,
                32
            );
            const lowerCutMat = new THREE.MeshPhongMaterial({ color: toolColor });
            const lowerCut = new THREE.Mesh(lowerCutGeom, lowerCutMat);
            lowerCut.position.y = cutWidth / 4; // Position so waist is at cutWidth/2
            group.add(lowerCut);
            
            // Upper cylinder (upper half of cutting area)
            const upperCutGeom = new THREE.CylinderGeometry(
                waistRadius, // radius at waist (center)
                waistRadius + (cutWidth * 0.25), // radius at top edge
                cutWidth / 2,
                32
            );
            const upperCutMat = new THREE.MeshPhongMaterial({ color: toolColor });
            const upperCut = new THREE.Mesh(upperCutGeom, upperCutMat);
            upperCut.position.y = cutWidth * 0.75; // Position above waist
            group.add(upperCut);
            
            // Add visual indicator ring at cutting point (center)
            const ringGeom = new THREE.TorusGeometry(waistRadius, 0.5, 8, 32);
            const ringMat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.position.y = cutWidth / 2; // At center (cutting point)
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
            
            // Tool shaft above cutting surface
            const rsShaftGeom = new THREE.CylinderGeometry(
                waistRadius * 0.6,
                waistRadius * 0.6,
                length - cutWidth,
                16
            );
            const rsShaftMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const rsShaft = new THREE.Mesh(rsShaftGeom, rsShaftMat);
            rsShaft.position.y = cutWidth + (length - cutWidth) / 2;
            group.add(rsShaft);
            break;

        default:
            // Default cylinder if unknown shape
            const defGeom = new THREE.CylinderGeometry(radius, radius, length, 16);
            const defMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
            const defMesh = new THREE.Mesh(defGeom, defMat);
            defMesh.position.y = length / 2;
            group.add(defMesh);
            break;
    }

    // Add cutting point indicator (red dot at origin - the cutting point)
    const pointGeom = new THREE.SphereGeometry(1, 8, 8);
    const pointMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const point = new THREE.Mesh(pointGeom, pointMat);
    point.position.y = 0; // Cutting point at origin (y=0)
    group.add(point);
    
    // Add 3D text label with PL number at top of shaft - only for active tool
    if (isActive && tool.pl !== undefined) {
        const loader = new FontLoader();
        // Using default Three.js font - load asynchronously
        loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', (font) => {
            const textGeometry = new TextGeometry(`T${tool.pl} ${tool.rotation}`, {
                font: font,
                size: 32,
                depth: 0.1,
                curveSegments: 4,
                bevelEnabled: false
            });
            
            textGeometry.center();
            
            const textMaterial = new THREE.MeshPhongMaterial({ 
                color: 0xffffff,
                emissive: 0x444444
            });
            const textMesh = new THREE.Mesh(textGeometry, textMaterial);
            
            // Position above shaft (at y = length + 5)
            textMesh.position.y = length + 5;
            
            // Rotate to face camera when looking from standard angle
            textMesh.rotation.x = -Math.PI / 2;
            
            // Scale down the depth (Z-axis after rotation becomes vertical thickness)
            textMesh.scale.z = 0.1;
            
            group.add(textMesh);
        }, undefined, (error) => {
            console.error('Error loading font:', error);
        });
    }

    return group;
}

function handlePreviewTool(e) {
    const index = parseInt(e.target.dataset.index);
    const tool = toolsLibrary[index];

    // Clear previous preview - remove all meshes and groups, keep only lights
    const objectsToRemove = [];
    previewScene.children.forEach(child => {
        if (child.type === 'Mesh' || child.type === 'Group') {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        previewScene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
            } else {
                obj.material.dispose();
            }
        }
    });

    // Create and add new tool
    const toolMesh = createToolGeometry(tool);
    previewScene.add(toolMesh);

    // Show preview panel
    document.getElementById('toolPreview').classList.add('active');
    document.getElementById('toolPreview').querySelector('h3').textContent = 
        `Preview: ${tool.name}`;

    currentPreviewIndex = index;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadTools();
    renderToolsTable();
    initPreview();

    // Event listeners - check if elements exist before adding listeners
    const addToolBtn = document.getElementById('addToolBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const preview = document.getElementById('toolPreview');
    
    if (addToolBtn) addToolBtn.addEventListener('click', handleAddTool);
    if (exportBtn) exportBtn.addEventListener('click', handleExport);
    if (importBtn) importBtn.addEventListener('click', handleImport);

    // Close preview when clicking outside
    if (preview) {
        document.addEventListener('click', (e) => {
            if (!preview.contains(e.target) && !e.target.classList.contains('preview-btn')) {
                preview.classList.remove('active');
            }
        });
    }
});

// Export function to get tool by PL and D number
export function getToolByPLD(pl, d) {
    const tool = toolsLibrary.find(t => t.pl === pl && t.d === d);
    return tool || null;
}

// Export function to get tool by PL only (returns first D number)
export function getToolByPL(pl) {
    const tool = toolsLibrary.find(t => t.pl === pl);
    return tool || null;
}

// Export function to get all D variants of a PL number
export function getAllToolsByPL(pl) {
    return toolsLibrary.filter(t => t.pl === pl).sort((a, b) => a.d - b.d);
}

export { toolsLibrary, createToolGeometry };
