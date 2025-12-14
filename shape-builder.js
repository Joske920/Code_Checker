import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Tool shapes storage
let customShapes = [];
let currentShape = null;

// Three.js scene setup
let scene, camera, renderer, controls, previewGroup;

// Initialize
init();
loadCustomShapes();
renderShapesList();

function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // Create camera
    const container = document.getElementById('shapeCanvas');
    camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(150, 150, 150);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Add controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // Add grid
    const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(100);
    scene.add(axesHelper);

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();

    // Setup event listeners
    setupEventListeners();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('shapeCanvas');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function setupEventListeners() {
    // New shape button
    document.getElementById('newShapeBtn').addEventListener('click', createNewShape);

    // Reset canvas button
    document.getElementById('resetCanvasBtn').addEventListener('click', resetCanvas);

    // Preview button
    document.getElementById('previewBtn').addEventListener('click', previewShape);

    // Save button
    document.getElementById('saveShapeBtn').addEventListener('click', saveShape);

    // Export code button
    document.getElementById('exportCodeBtn').addEventListener('click', exportCode);

    // Delete button
    document.getElementById('deleteShapeBtn').addEventListener('click', deleteShape);

    // Component select
    const componentSelect = document.getElementById('componentSelect');
    if (componentSelect) {
        componentSelect.addEventListener('change', (e) => {
            const component = e.target.value;
            if (component) {
                insertComponent(component);
                e.target.value = ''; // Reset selection
            }
        });
    }
}

function loadCustomShapes() {
    const saved = localStorage.getItem('customToolShapes');
    if (saved) {
        try {
            customShapes = JSON.parse(saved);
            console.log(`Loaded ${customShapes.length} custom shapes`);
        } catch (e) {
            console.error('Error loading shapes:', e);
            customShapes = [];
        }
    }
}

function saveCustomShapes() {
    localStorage.setItem('customToolShapes', JSON.stringify(customShapes));
    console.log('Custom shapes saved');
}

function renderShapesList() {
    const list = document.getElementById('shapeList');
    list.innerHTML = '';

    // Add default shapes first with their code
    const defaultShapes = [
        { 
            value: 'cylinder', 
            label: 'Frees (Cilinder)', 
            builtin: true,
            code: `// Cutting disc at origin (y=0) - this is the cutting point
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
group.add(shaft);`
        },
        { 
            value: 'drill', 
            label: 'Boor', 
            builtin: true,
            code: `// Boortip (kegel aan de onderkant)
const tipLength = length * 0.2;
const tipGeometry = new THREE.ConeGeometry(radius, tipLength, 32);
const tipMaterial = new THREE.MeshPhongMaterial({ color: toolColor });
const tip = new THREE.Mesh(tipGeometry, tipMaterial);
tip.position.y = tipLength / 2;
tip.rotation.x = Math.PI; // Draai 180° zodat punt naar beneden wijst
group.add(tip);

// Hoofdlichaam van de boor (cilinder)
const bodyLength = length * 0.6;
const bodyGeometry = new THREE.CylinderGeometry(radius, radius, bodyLength, 64);
const bodyMaterial = new THREE.MeshPhongMaterial({ color: toolColor });
const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
body.position.y = tipLength + bodyLength / 2;
group.add(body);

// Spiraalflutes (2 stuks voor tweesnijdende boor)
const flutes = 2;
const turns = 3;
const helixResolution = 150;
const fluteHeight = bodyLength;

const helixPoints = [];
for (let i = 0; i < helixResolution; i++) {
    const t = i / (helixResolution - 1);
    const y = t * fluteHeight + tipLength;
    const angle = turns * Math.PI * 2 * t;
    const r = radius * 0.95;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    helixPoints.push(new THREE.Vector3(x, y, z));
}

const fluteGeometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(helixPoints),
    200,
    radius * 0.15,
    8,
    false
);
const fluteMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });

// Eerste flute
const flute1 = new THREE.Mesh(fluteGeometry, fluteMaterial);
group.add(flute1);

// Tweede flute (180° gedraaid)
const flute2 = flute1.clone();
flute2.rotation.y = Math.PI;
group.add(flute2);

// Schacht bovenaan
const shaftLength = length * 0.2;
const shaftGeometry = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, shaftLength, 32);
const shaftMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 });
const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
shaft.position.y = tipLength + bodyLength + shaftLength / 2;
group.add(shaft);`
        },
        { 
            value: 'ball', 
            label: 'Balfrees', 
            builtin: true,
            code: `// Ball tip at origin (y=0)
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
group.add(ballBody);`
        },
        { 
            value: 'cone', 
            label: 'Kegel (V-groeffrees)', 
            builtin: true,
            code: `// Cone tip at origin (y=0)
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
group.add(coneBody);`
        },
        { 
            value: 'chamfer', 
            label: 'Afschuinfrees', 
            builtin: true,
            code: `// Chamfer tip at origin (y=0)
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
group.add(chamBody);`
        },
        { 
            value: 'roundshaper', 
            label: 'Rondschaaf', 
            builtin: true,
            code: `// Special tool: rounded profile cutter
const cutWidth = width || 54;
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
group.add(rsShaft);`
        }
    ];

    defaultShapes.forEach(shape => {
        const li = document.createElement('li');
        li.className = 'shape-item';
        if (currentShape && currentShape.value === shape.value) {
            li.classList.add('active');
        }
        li.innerHTML = `
            <div class="shape-item-name">${shape.label}</div>
            <div class="shape-item-type">Ingebouwd</div>
        `;
        li.addEventListener('click', () => loadShape(shape));
        list.appendChild(li);
    });

    // Add custom shapes
    customShapes.forEach((shape, index) => {
        const li = document.createElement('li');
        li.className = 'shape-item';
        if (currentShape && currentShape.value === shape.value) {
            li.classList.add('active');
        }
        li.innerHTML = `
            <div class="shape-item-name">${shape.label}</div>
            <div class="shape-item-type">Custom</div>
        `;
        li.addEventListener('click', () => loadShape(shape));
        list.appendChild(li);
    });
}

function resetCanvas() {
    // Maak canvas leeg
    if (previewGroup) {
        previewGroup.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(mat => mat.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        scene.remove(previewGroup);
        previewGroup = null;
    }
    
    // Reset editor velden
    currentShape = null;
    document.getElementById('shapeName').value = '';
    document.getElementById('shapeLabel').value = '';
    document.getElementById('shapeCode').value = '';
    document.getElementById('shapeName').disabled = false;
    document.getElementById('shapeLabel').disabled = false;
    document.getElementById('shapeCode').readOnly = false;
    document.getElementById('saveShapeBtn').disabled = false;
    document.getElementById('deleteShapeBtn').disabled = true;
    document.getElementById('currentShapeName').textContent = 'Geen vorm geselecteerd';
    document.getElementById('shapeStats').innerHTML = '';
    
    // Verwijder active class van alle shapes
    document.querySelectorAll('.shape-item').forEach(item => item.classList.remove('active'));
}

function createNewShape() {
    currentShape = {
        value: 'custom_' + Date.now(),
        label: 'Nieuwe Vorm',
        code: '',
        builtin: false
    };

    document.getElementById('shapeName').value = currentShape.value;
    document.getElementById('shapeLabel').value = currentShape.label;
    document.getElementById('shapeName').disabled = false;
    document.getElementById('shapeLabel').disabled = false;
    document.getElementById('shapeCode').readOnly = false;
    document.getElementById('saveShapeBtn').disabled = false;
    document.getElementById('deleteShapeBtn').disabled = false;
    document.getElementById('shapeCode').value = `// Voorbeeld: Simpele cilinder
const geom = new THREE.CylinderGeometry(radius, radius, length, 32);
const mat = new THREE.MeshPhongMaterial({ color: toolColor });
const mesh = new THREE.Mesh(geom, mat);
mesh.position.y = length / 2; // Centreer op Y-as
group.add(mesh);

// Voeg een ring toe op snijpunt (Y=0)
const ringGeom = new THREE.TorusGeometry(radius, 0.5, 8, 32);
const ringMat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
const ring = new THREE.Mesh(ringGeom, ringMat);
ring.position.y = 0;
ring.rotation.x = Math.PI / 2;
group.add(ring);`;

    document.getElementById('currentShapeName').textContent = currentShape.label;
    renderShapesList();
    previewShape();
}

function loadShape(shape) {
    currentShape = shape;

    document.getElementById('shapeName').value = shape.value || '';
    document.getElementById('shapeLabel').value = shape.label || '';
    document.getElementById('shapeCode').value = shape.code || '';

    document.getElementById('currentShapeName').textContent = shape.label;

    // Disable editing for builtin shapes (but allow shapeCode editing for experimentation)
    const isBuiltin = shape.builtin === true;
    document.getElementById('shapeName').disabled = isBuiltin;
    document.getElementById('shapeLabel').disabled = isBuiltin;
    document.getElementById('shapeCode').readOnly = false; // Always allow editing
    document.getElementById('saveShapeBtn').disabled = isBuiltin;
    document.getElementById('deleteShapeBtn').disabled = isBuiltin;

    renderShapesList();
    
    if (shape.code) {
        previewShape();
    }
}

function previewShape() {
    // Remove previous preview and clean up resources
    if (previewGroup) {
        // Dispose all geometries and materials
        previewGroup.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(mat => mat.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        scene.remove(previewGroup);
        previewGroup = null;
    }

    previewGroup = new THREE.Group();

    // Test parameters
    const radius = 10;
    const length = 50;
    const width = 20;
    const toolColor = 0xff4444; // Red
    const group = previewGroup;

    // Get code from editor
    const code = document.getElementById('shapeCode').value;

    try {
        // Execute the code
        eval(code);

        // Add to scene
        scene.add(previewGroup);

        // Update stats
        let vertexCount = 0;
        previewGroup.traverse(obj => {
            if (obj.geometry) {
                vertexCount += obj.geometry.attributes.position.count;
            }
        });

        document.getElementById('shapeStats').innerHTML = `
            Objecten: ${previewGroup.children.length}<br>
            Vertices: ${vertexCount}
        `;

        console.log('Preview generated successfully');
    } catch (error) {
        console.error('Error generating preview:', error);
        alert('Fout in code:\n' + error.message);
        document.getElementById('shapeStats').innerHTML = `
            <span style="color: #ff4444;">Error: ${error.message}</span>
        `;
    }
}

function saveShape() {
    if (!currentShape || currentShape.builtin) {
        alert('Ingebouwde vormen kunnen niet worden aangepast');
        return;
    }

    const name = document.getElementById('shapeName').value.trim();
    const label = document.getElementById('shapeLabel').value.trim();
    const code = document.getElementById('shapeCode').value.trim();

    if (!name || !label || !code) {
        alert('Vul alle velden in');
        return;
    }

    // Validate name (lowercase, no spaces)
    if (!/^[a-z0-9_]+$/.test(name)) {
        alert('Vorm naam mag alleen lowercase letters, cijfers en underscores bevatten');
        return;
    }

    // Update or add shape
    const existingIndex = customShapes.findIndex(s => s.value === currentShape.value);
    const shapeData = {
        value: name,
        label: label,
        code: code,
        builtin: false
    };

    if (existingIndex >= 0) {
        customShapes[existingIndex] = shapeData;
    } else {
        customShapes.push(shapeData);
    }

    currentShape = shapeData;
    saveCustomShapes();
    renderShapesList();

    alert('Vorm opgeslagen! Gebruik "' + name + '" in je tools.');
    console.log('Shape saved:', shapeData);
}

function deleteShape() {
    if (!currentShape || currentShape.builtin) {
        alert('Ingebouwde vormen kunnen niet worden verwijderd');
        return;
    }

    if (!confirm(`Weet je zeker dat je "${currentShape.label}" wilt verwijderen?`)) {
        return;
    }

    const index = customShapes.findIndex(s => s.value === currentShape.value);
    if (index >= 0) {
        customShapes.splice(index, 1);
        saveCustomShapes();
        renderShapesList();

        // Clear editor
        currentShape = null;
        document.getElementById('shapeName').value = '';
        document.getElementById('shapeLabel').value = '';
        document.getElementById('shapeCode').value = '';
        document.getElementById('currentShapeName').textContent = 'Geen vorm geselecteerd';

        // Remove preview
        if (previewGroup) {
            scene.remove(previewGroup);
        }

        alert('Vorm verwijderd');
    }
}

function exportCode() {
    const name = document.getElementById('shapeName').value.trim();
    const label = document.getElementById('shapeLabel').value.trim();
    const code = document.getElementById('shapeCode').value.trim();

    if (!name || !label || !code) {
        alert('Vul alle velden in voordat je exporteert');
        return;
    }

    const exportCode = `
// Add to toolShapes array in tools.js:
{ value: '${name}', label: '${label}' }

// Add this case to createToolGeometry() switch statement in tools.js:
case '${name}':
${code.split('\n').map(line => '    ' + line).join('\n')}
    break;
`;

    // Copy to clipboard
    navigator.clipboard.writeText(exportCode).then(() => {
        alert('Code gekopieerd naar clipboard!\n\nPlak dit in tools.js om de vorm permanent toe te voegen.');
    }).catch(err => {
        // Fallback: show in alert
        prompt('Kopieer deze code en plak in tools.js:', exportCode);
    });
}

function insertComponent(componentType) {
    const codeArea = document.getElementById('shapeCode');
    const templates = {
        cylinder: `
// Cilinder component
const cylGeom = new THREE.CylinderGeometry(radius, radius, length, 32);
const cylMat = new THREE.MeshPhongMaterial({ color: toolColor });
const cylinder = new THREE.Mesh(cylGeom, cylMat);
cylinder.position.y = length / 2;
group.add(cylinder);`,
        
        cone: `
// Kegel component
const coneGeom = new THREE.ConeGeometry(radius, length * 0.5, 32);
const coneMat = new THREE.MeshPhongMaterial({ color: toolColor });
const cone = new THREE.Mesh(coneGeom, coneMat);
cone.position.y = length * 0.25;
cone.rotation.x = Math.PI; // Point down
group.add(cone);`,
        
        sphere: `
// Bol component
const sphereGeom = new THREE.SphereGeometry(radius, 32, 32);
const sphereMat = new THREE.MeshPhongMaterial({ color: toolColor });
const sphere = new THREE.Mesh(sphereGeom, sphereMat);
sphere.position.y = radius; // Bottom at Y=0
group.add(sphere);`,
        
        torus: `
// Torus component
const torusGeom = new THREE.TorusGeometry(radius, radius * 0.3, 16, 32);
const torusMat = new THREE.MeshPhongMaterial({ color: toolColor });
const torus = new THREE.Mesh(torusGeom, torusMat);
torus.position.y = 0;
torus.rotation.x = Math.PI / 2;
group.add(torus);`,
        
        ring: `
// Ring (marker) component
const ringGeom = new THREE.TorusGeometry(radius, 0.5, 8, 32);
const ringMat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
const ring = new THREE.Mesh(ringGeom, ringMat);
ring.position.y = 0; // At cutting point
ring.rotation.x = Math.PI / 2;
group.add(ring);`
    };

    const template = templates[componentType];
    if (template) {
        const currentCode = codeArea.value;
        const newCode = currentCode + (currentCode ? '\n' : '') + template;
        codeArea.value = newCode;
        
        // Auto-preview
        previewShape();
    }
}

// Resizer functionality
function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorPanel = document.getElementById('editorPanel');
    const canvasPanel = document.querySelector('.canvas-panel');
    
    let isResizing = false;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const containerWidth = document.querySelector('.container').offsetWidth;
        const shapesWidth = document.querySelector('.shapes-panel').offsetWidth;
        const resizerWidth = resizer.offsetWidth;
        
        // Calculate new width from right edge
        const newWidth = containerWidth - e.clientX;
        
        // Apply constraints
        const minWidth = 300;
        const maxWidth = 800;
        const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        
        editorPanel.style.width = constrainedWidth + 'px';
        
        // Trigger canvas resize
        if (renderer && camera) {
            const container = document.getElementById('shapeCanvas');
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Initialize resizer when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initResizer);
} else {
    initResizer();
}

