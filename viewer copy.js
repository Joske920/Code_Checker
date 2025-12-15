import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getToolByPL, getToolByPLD, getAllToolsByPL, createToolGeometry } from './tools.js';

// Three.js CNC Toolpath Viewer
class CNCViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.toolpath = null;
        this.rapidMoves = null;
        this.grid = null;
        this.axes = null;
        
        // Start at safe tool change Z position
        const safeZ = parseFloat(localStorage.getItem('safeToolChangeZ')) || 450;
        this.currentPosition = { x: 0, y: 0, z: safeZ };
        
        this.previousPosition = { x: 0, y: 0, z: 0 }; // For calculating tool compensation direction
        this.currentRotation = { x: 0, y: 0, z: 0 }; // Siemens 840D AROT rotations
        this.currentOffset = { x: 0, y: 0, z: 0 }; // Siemens 840D TRANS offset (origin shift)
        this.rotationMatrix = new THREE.Matrix4(); // Transformation matrix for rotated coordinate system
        this.currentTool = null; // Current active tool (PL+D combination)
        this.currentPL = null; // Current PL (plaats) number
        this.currentD = null; // Current D number
        this.radiusCompensation = 'G40'; // G40=off, G41=left, G42=right
        this.toolpathPoints = [];
        this.rapidPoints = [];
        this.doorOutline = null;
        this.rotationHelper = null; // Visual indicator for current rotation
        
        // Animation properties
        this.animationSteps = [];
        this.currentStepIndex = 0;
        this.isAnimating = false;
        this.animationSpeed = parseInt(localStorage.getItem('cncAnimationSpeed')) || 100; // ms per step, saved in localStorage
        
        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            10000
        );
        this.camera.position.set(200, 200, 200);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 0; // Minimum zoom distance - increased for better control
        this.controls.maxDistance = 3000; // Maximum zoom distance
        this.controls.zoomSpeed = 1; // Slower zoom for better control
        this.controls.panSpeed = 1; // Slower pan for better control
        this.controls.rotateSpeed = 1; // Slower rotation for better control

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 50);
        this.scene.add(directionalLight);

        // Axes
        this.axes = new THREE.AxesHelper(100);
        this.scene.add(this.axes);
        
        // Door outline placeholder
        this.doorOutline = null;

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start animation loop
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        if (!this.container) return;
        
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    clear() {
        // Remove all objects from scene except axes and lights
        const objectsToRemove = [];
        this.scene.traverse((object) => {
            if (object !== this.scene && 
                object !== this.axes && 
                object.type !== 'AmbientLight' && 
                object.type !== 'DirectionalLight') {
                objectsToRemove.push(object);
            }
        });
        
        objectsToRemove.forEach((object) => {
            this.scene.remove(object);
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
        });
        
        this.toolpath = null;
        this.rapidMoves = null;
        this.doorOutline = null;
        this.rotationHelper = null;
        
        if (this.doorOutline) {
            this.scene.remove(this.doorOutline);
            // Also remove the door surface if it exists
            if (this.doorOutline.userData && this.doorOutline.userData.surface) {
                this.scene.remove(this.doorOutline.userData.surface);
                this.doorOutline.userData.surface.geometry.dispose();
                this.doorOutline.userData.surface.material.dispose();
            }
            this.doorOutline.geometry.dispose();
            this.doorOutline.material.dispose();
            this.doorOutline = null;
        }
        
        if (this.rotationHelper) {
            this.scene.remove(this.rotationHelper);
            // Dispose of all meshes in the group
            this.rotationHelper.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.rotationHelper = null;
        }

        this.toolpathPoints = [];
        this.rapidPoints = [];
        
        // Start at safe tool change Z position
        const safeZ = parseFloat(localStorage.getItem('safeToolChangeZ')) || 450;
        this.currentPosition = { x: 0, y: 0, z: safeZ };
        console.log(`[clear] Starting position set to safe Z: ${safeZ}`);
        
        this.currentRotation = { x: 0, y: 0, z: 0 };
        this.currentOffset = { x: 0, y: 0, z: 0 };
        this.radiusCompensation = 'G40'; // Reset to no compensation
        this.rotationMatrix = new THREE.Matrix4();
        this.animationSteps = [];
        this.currentStepIndex = 0;
        this.isAnimating = false;
    }

    parseGCode(gcode) {
        console.log('[parseGCode] Starting parse, G-code length:', gcode.length);
        
        this.clear();
        this.animationSteps = [];

        // Resolve machine variables before parsing
        console.log('[parseGCode] Calling resolveMachineVariables...');
        gcode = this.resolveMachineVariables(gcode);
        console.log('[parseGCode] After variable resolution, G-code length:', gcode.length);

        const lines = gcode.split('\n');
        let isAbsolute = true; // G90/G91
        let currentFeed = 0;
        let lineNumber = 0;
        let currentGCode = null; // Modal G-code state (G0, G1, G2, G3)

        lines.forEach(line => {
            lineNumber++;
            const originalLine = line;
            
            try {
                // Remove comments and whitespace
                line = line.split(';')[0].split('(')[0].trim().toUpperCase();
                if (!line) return;
                
                // Debug: log lines that contain Z= and are near the end
                if (line.includes('Z=') && lineNumber > lines.length - 10) {
                    console.log(`[parseGCode] Line ${lineNumber}/${lines.length}: "${line}"`);
                }

            // Check for positioning mode
            if (line.includes('G90')) {
                isAbsolute = true;
                return;
            }
            if (line.includes('G91')) {
                isAbsolute = false;
                return;
            }
            
            // Parse Siemens 840D AROT command (axis rotation)
            if (line.includes('AROT')) {
                console.log(`Found AROT command: ${line}`);
                const rotationData = this.parseAROT(line, lineNumber, originalLine);
                if (rotationData) {
                    console.log('AROT parsed successfully:', rotationData);
                    this.animationSteps.push(rotationData);
                    this.currentRotation = rotationData.to;
                    this.updateRotationMatrix();
                    this.updateRotationHelper();
                }
                return;
            }
            
            // Parse Siemens 840D TRANS command (origin offset/translation)
            if (line.includes('TRANS')) {
                console.log(`Found TRANS command: ${line}`);
                const transData = this.parseTRANS(line, lineNumber, originalLine);
                if (transData) {
                    console.log('TRANS parsed successfully:', transData);
                    this.animationSteps.push(transData);
                    this.currentOffset = transData.to;
                }
                return;
            }
            
            // Parse Siemens 840D TRAFOOF command (reset transformation/rotation/offset)
            if (line.includes('TRAFOOF')) {
                console.log(`Found TRAFOOF command: ${line}`);
                const resetData = this.parseTRAFOOF(line, lineNumber, originalLine);
                this.animationSteps.push(resetData);
                this.currentRotation = { x: 0, y: 0, z: 0 };
                this.currentOffset = { x: 0, y: 0, z: 0 };
                this.updateRotationMatrix();
                this.updateRotationHelper();
                return;
            }
            
            // Parse tool change command (T followed by number)
            const toolMatch = line.match(/T(\d+)/);
            if (toolMatch) {
                const plNumber = parseInt(toolMatch[1]);
                console.log(`Found tool change: T${plNumber} (PL=${plNumber})`);
                this.currentPL = plNumber;
                
                // Check for D number on same line
                const dMatch = line.match(/D(\d+)/);
                if (dMatch) {
                    const dNumber = parseInt(dMatch[1]);
                    this.currentD = dNumber;
                    this.currentTool = getToolByPLD(plNumber, dNumber);
                    console.log(`Tool PL${plNumber} D${dNumber} selected`, this.currentTool);
                } else {
                    // No D specified, use first available D for this PL
                    this.currentTool = getToolByPL(plNumber);
                    if (this.currentTool) {
                        this.currentD = this.currentTool.d;
                    }
                    console.log(`Tool PL${plNumber} selected (D${this.currentD})`, this.currentTool);
                }
                
                this.updateRotationHelper();
                
                const description = this.currentTool 
                    ? `T${plNumber} D${this.currentD}: ${this.currentTool.name} (R${this.currentTool.radius}mm, L${this.currentTool.length}mm)`
                    : `T${plNumber} D${this.currentD || 1} (standaard)`;
                
                // Move to safe Z position during tool change
                const safeZ = parseFloat(localStorage.getItem('safeToolChangeZ')) || 450;
                const oldZ = this.currentPosition.z;
                this.currentPosition.z = safeZ;
                
                this.animationSteps.push({
                    lineNumber,
                    originalLine: originalLine.trim(),
                    command: 'TOOL_CHANGE',
                    pl: plNumber,
                    d: this.currentD,
                    tool: this.currentTool,
                    description: description,
                    from: { ...this.currentPosition, z: oldZ },
                    to: { ...this.currentPosition, z: safeZ },
                    safeZ: safeZ
                });
                return;
            }
            
            // Parse D number (offset selector) - can appear separately from T
            // BUT: Don't process if line also contains movement coordinates (will be handled later)
            const dMatch = line.match(/D(\d+)/);
            const hasMovementCoords = /[XYZ]=?[-+]?\d*\.?\d+/.test(line);
            
            if (dMatch && !toolMatch) {
                const dNumber = parseInt(dMatch[1]);
                console.log(`[parseGCode] Line ${lineNumber}: D${dNumber} found, hasMovementCoords=${hasMovementCoords}`);
                
                if (!hasMovementCoords) {
                    // D change without movement - create OFFSET_CHANGE step
                    this.currentD = dNumber;
                    if (this.currentPL) {
                        this.currentTool = getToolByPLD(this.currentPL, dNumber);
                        console.log(`Offset changed to D${dNumber}`, this.currentTool);
                        
                        const description = this.currentTool
                            ? `T${this.currentPL} D${dNumber}: ${this.currentTool.name} (R${this.currentTool.radius}mm, L${this.currentTool.length}mm)`
                            : `T${this.currentPL} D${dNumber} (niet gevonden in library)`;
                        
                        this.updateRotationHelper();
                        
                        this.animationSteps.push({
                            lineNumber,
                            originalLine: originalLine.trim(),
                            command: 'OFFSET_CHANGE',
                            pl: this.currentPL,
                            d: dNumber,
                            tool: this.currentTool,
                            description: description
                        });
                    }
                    return;
                } else {
                    // D change WITH movement - update D but let movement be processed
                    this.currentD = dNumber;
                    if (this.currentPL) {
                        this.currentTool = getToolByPLD(this.currentPL, dNumber);
                        console.log(`Offset changed to D${dNumber} with movement`, this.currentTool);
                        this.updateRotationHelper();
                    }
                    // Don't return - continue to process movement
                }
            }

            // Check for explicit G-code commands to update modal state
            const hasG00 = line.includes('G0') && !line.includes('G01') && !line.includes('G02') && !line.includes('G03');
            const hasG01 = line.includes('G1') && !line.includes('G01') ? line.match(/\bG1\b/) : line.includes('G01');
            const hasG02 = line.includes('G2') && !line.includes('G02') ? line.match(/\bG2\b/) : line.includes('G02');
            const hasG03 = line.includes('G3') && !line.includes('G03') ? line.match(/\bG3\b/) : line.includes('G03');
            
            // Check for tool radius compensation commands
            if (line.match(/\bG40\b/)) this.radiusCompensation = 'G40'; // Cancel compensation
            if (line.match(/\bG41\b/)) this.radiusCompensation = 'G41'; // Left compensation
            if (line.match(/\bG42\b/)) this.radiusCompensation = 'G42'; // Right compensation

            // Update modal G-code if a new one is specified
            if (hasG00) currentGCode = 'G0';
            else if (hasG01) currentGCode = 'G1';
            else if (hasG02) currentGCode = 'G2';
            else if (hasG03) currentGCode = 'G3';

            // Check if line has coordinates (X, Y, Z, I, J, K, R)
            const hasCoordinates = /[XYZIJKR]([-+]?\d*\.?\d+)/.test(line);
            
            // Process movement if we have a modal G-code and coordinates
            if (currentGCode && hasCoordinates) {
                const newPos = this.parseCoordinates(line, isAbsolute);
                
                console.log(`[parseGCode] Line ${lineNumber}: ${line} -> newPos: (${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)}, ${newPos.z.toFixed(2)})`);
                
                // Skip if position hasn't changed
                if (newPos.x === this.currentPosition.x && 
                    newPos.y === this.currentPosition.y && 
                    newPos.z === this.currentPosition.z) {
                    console.log(`[parseGCode] Line ${lineNumber}: Position unchanged, skipping`);
                    return;
                }
                
                const stepInfo = {
                    lineNumber,
                    originalLine: originalLine.trim(),
                    command: currentGCode,
                    from: { ...this.currentPosition },
                    to: { ...newPos },
                    isRapid: currentGCode === 'G0',
                    radiusCompensation: this.radiusCompensation  // Save G40/G41/G42 state
                };
                
                if (currentGCode === 'G0') {
                    // Rapid move (dashed line)
                    this.addRapidMove(this.currentPosition, newPos);
                } else if (currentGCode === 'G1') {
                    // Linear cutting move
                    this.addCuttingMove(this.currentPosition, newPos);
                } else if (currentGCode === 'G2' || currentGCode === 'G3') {
                    // Arc move
                    console.log(`Parsing arc command: ${line}`);
                    const arcData = this.parseArc(line, isAbsolute, currentGCode === 'G2');
                    if (arcData) {
                        console.log('Arc data parsed successfully:', arcData);
                        this.addArcMove(arcData, currentGCode === 'G2');
                        stepInfo.arcData = arcData;
                    } else {
                        console.warn('Failed to parse arc data from:', line);
                        // Fallback to linear move
                        this.addCuttingMove(this.currentPosition, newPos);
                    }
                }
                
                this.animationSteps.push(stepInfo);
                this.previousPosition = { ...this.currentPosition };
                this.currentPosition = newPos;
            }
            } catch (error) {
                console.error(`[parseGCode] Error parsing line ${lineNumber}: "${originalLine}"`, error);
            }
        });

        this.renderToolpath();
        this.fitCameraToObject();
        
        console.log(`Parsed ${this.animationSteps.length} animation steps`);
        
        // Find all steps with Z movement
        const zMovements = this.animationSteps.filter(step => 
            step.to && step.from && Math.abs(step.to.z - step.from.z) > 0.1
        );
        console.log(`Found ${zMovements.length} steps with Z movement`);
        console.log(`Last 5 Z movements:`, zMovements.slice(-5).map(s => ({
            line: s.lineNumber,
            from: s.from,
            to: s.to,
            command: s.command
        })));
        
        console.log(`Last 3 animation steps:`, this.animationSteps.slice(-3));
    }
    
    parseAROT(line, lineNumber, originalLine) {
        // Siemens 840D AROT command: AROT X90 Y0 Z180
        // Parse rotation angles for each axis
        const newRot = { ...this.currentRotation };
        
        const xMatch = line.match(/X([-+]?\d*\.?\d+)/);
        const yMatch = line.match(/Y([-+]?\d*\.?\d+)/);
        const zMatch = line.match(/Z([-+]?\d*\.?\d+)/);
        
        if (xMatch) newRot.x = parseFloat(xMatch[1]);
        if (yMatch) newRot.y = parseFloat(yMatch[1]);
        if (zMatch) newRot.z = parseFloat(zMatch[1]);
        
        return {
            lineNumber,
            originalLine: originalLine.trim(),
            command: 'AROT',
            from: { ...this.currentRotation },
            to: { ...newRot },
            isRotation: true,
            description: `Rotatie: X=${newRot.x}° Y=${newRot.y}° Z=${newRot.z}°`
        };
    }
    
    parseTRANS(line, lineNumber, originalLine) {
        // Siemens 840D TRANS command: translates/shifts the origin (nulpunt)
        // Format: TRANS X=value Y=value Z=value
        // Can include expressions like X=2515+XOFFSET
        
        const from = { ...this.currentOffset };
        const to = { ...this.currentOffset };
        
        // Parse X, Y, Z values (extract numeric part before + or end of value)
        const xMatch = line.match(/X\s*=\s*([+-]?\d+\.?\d*)/);
        const yMatch = line.match(/Y\s*=\s*([+-]?\d+\.?\d*)/);
        const zMatch = line.match(/Z\s*=\s*([+-]?\d+\.?\d*)/);
        
        if (xMatch) to.x = parseFloat(xMatch[1]);
        if (yMatch) to.y = parseFloat(yMatch[1]);
        if (zMatch) to.z = parseFloat(zMatch[1]);
        
        return {
            lineNumber,
            originalLine: originalLine.trim(),
            command: 'TRANS',
            from,
            to,
            isTranslation: true,
            description: `Nulpunt verschuiving: X${to.x.toFixed(1)} Y${to.y.toFixed(1)} Z${to.z.toFixed(1)}`
        };
    }
    
    parseTRAFOOF(line, lineNumber, originalLine) {
        // Siemens 840D TRAFOOF command: resets all transformations/rotations/offsets to default
        return {
            lineNumber,
            originalLine: originalLine.trim(),
            command: 'TRAFOOF',
            fromRotation: { ...this.currentRotation },
            fromOffset: { ...this.currentOffset },
            toRotation: { x: 0, y: 0, z: 0 },
            toOffset: { x: 0, y: 0, z: 0 },
            isReset: true,
            description: 'Reset transformatie (TRAFOOF)'
        };
    }
    
    updateRotationMatrix() {
        // Update the transformation matrix based on current rotation
        // This matrix transforms points from the tool's local coordinate system
        // to the world coordinate system
        
        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(this.currentRotation.x),
            THREE.MathUtils.degToRad(this.currentRotation.z), // CNC Z -> Three.js Y
            THREE.MathUtils.degToRad(-this.currentRotation.y), // CNC Y -> Three.js -Z
            'ZYX'
        );
        
        this.rotationMatrix.makeRotationFromEuler(euler);
        
        console.log('Updated rotation matrix for:', this.currentRotation);
    }

    resolveMachineVariables(gcode) {
        // Get machine variables from localStorage
        const saved = localStorage.getItem('machineVariables');
        console.log('[resolveMachineVariables] localStorage raw:', saved);
        
        if (!saved) {
            console.log('No machine variables defined');
            return gcode;
        }
        
        const variables = JSON.parse(saved);
        console.log('Machine variables loaded:', variables);
        console.log('Number of variables:', Object.keys(variables).length);
        
        // Replace all variables in the G-code
        let resolvedCode = gcode;
        let replacementCount = 0;
        
        // Debug: check if G-code contains the variable name
        Object.entries(variables).forEach(([name, value]) => {
            const found = gcode.includes(name);
            console.log(`Variable "${name}" (value="${value}") found in G-code: ${found}`);
            if (found) {
                const index = gcode.indexOf(name);
                console.log(`G-code sample around variable: ...${gcode.substring(index - 20, index + name.length + 20)}...`);
            } else {
                console.log(`Variable NOT found. Checking case-insensitive...`);
                const foundCI = gcode.toUpperCase().includes(name.toUpperCase());
                console.log(`Case-insensitive search: ${foundCI}`);
            }
        });
        
        Object.entries(variables).forEach(([name, value]) => {
            // Escape special regex characters except $ and []
            // Need to escape: . * + ? ^ ( ) | \ { }
            let escapedName = name
                .replace(/\\/g, '\\\\')
                .replace(/\./g, '\\.')
                .replace(/\*/g, '\\*')
                .replace(/\+/g, '\\+')
                .replace(/\?/g, '\\?')
                .replace(/\^/g, '\\^')
                .replace(/\(/g, '\\(')
                .replace(/\)/g, '\\)')
                .replace(/\|/g, '\\|')
                .replace(/\{/g, '\\{')
                .replace(/\}/g, '\\}')
                .replace(/\$/g, '\\$')
                .replace(/\[/g, '\\[')
                .replace(/\]/g, '\\]');
            
            const regex = new RegExp(escapedName, 'g');
            
            // Count occurrences before replacement
            const matches = resolvedCode.match(regex);
            if (matches) {
                replacementCount += matches.length;
                console.log(`Replacing ${matches.length} occurrence(s) of "${name}" with "${value}"`);
                console.log(`  Regex pattern: ${escapedName}`);
            }
            
            resolvedCode = resolvedCode.replace(regex, value);
        });
        
        console.log(`Total machine variable replacements: ${replacementCount}`);
        if (replacementCount > 0) {
            console.log('G-code after variable substitution (first 500 chars):', resolvedCode.substring(0, 500));
        }
        
        return resolvedCode;
    }
    
    updateRotationHelper(nextMovementStep = null) {
        // Remove existing helper
        if (this.rotationHelper) {
            this.scene.remove(this.rotationHelper);
            // Dispose of all meshes in the group
            this.rotationHelper.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.rotationHelper = null;
        }
        
        // Create a group to hold the tool orientation visualization
        this.rotationHelper = new THREE.Group();
        
        // If we have a current PL number, get all D variants
        if (this.currentPL) {
            const allTools = getAllToolsByPL(this.currentPL);
            
            if (allTools.length > 0) {
                // Sort by length to determine offsets
                const sortedTools = [...allTools].sort((a, b) => a.length - b.length);
                
                // The active tool (currentD) is at y=0 (cutting point)
                // Other tools extend below based on length difference
                allTools.forEach(tool => {
                    try {
                        const toolMesh = createToolGeometry(tool);
                        
                        // If this is not the active D, offset it downward
                        if (tool.d !== this.currentD) {
                            const activeTool = this.currentTool || allTools.find(t => t.d === this.currentD);
                            if (activeTool) {
                                // Offset = difference in lengths
                                const lengthDiff = tool.length - activeTool.length;
                                toolMesh.position.y = -lengthDiff;
                            }
                        }
                        
                        this.rotationHelper.add(toolMesh);
                    } catch (error) {
                        console.error('Error creating tool geometry:', error);
                    }
                });
                
                console.log(`Visualizing ${allTools.length} D variant(s) for PL${this.currentPL}, active D${this.currentD}`);
            } else {
                // No tools found, use default
                this.addDefaultToolIndicator();
            }
        } else if (this.currentTool) {
            // Fallback: only show current tool
            try {
                const toolMesh = createToolGeometry(this.currentTool);
                this.rotationHelper.add(toolMesh);
                console.log(`Using tool from library: ${this.currentTool.name}`);
            } catch (error) {
                console.error('Error creating tool geometry:', error);
                this.addDefaultToolIndicator();
            }
        } else {
            // Use default tool indicator
            this.addDefaultToolIndicator();
        }
        
        // Add axes to show orientation clearly
        const axes = new THREE.AxesHelper(80);
        this.rotationHelper.add(axes);
        
        // Calculate tool position with radius compensation
        let toolPos = { ...this.currentPosition };
        
        if (this.radiusCompensation !== 'G40' && this.currentTool && this.currentTool.radius && nextMovementStep) {
            // Calculate direction from current position to next position
            const dx = nextMovementStep.to.x - this.currentPosition.x;
            const dy = nextMovementStep.to.y - this.currentPosition.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            
            if (len > 0.0001) {
                const nx = dx / len;
                const ny = dy / len;
                
                // Calculate perpendicular offset
                let offsetX, offsetY;
                if (this.radiusCompensation === 'G41') {
                    // Left of path (counter-clockwise 90°)
                    offsetX = -ny * this.currentTool.radius;
                    offsetY = nx * this.currentTool.radius;
                } else { // G42
                    // Right of path (clockwise 90°)
                    offsetX = ny * this.currentTool.radius;
                    offsetY = -nx * this.currentTool.radius;
                }
                
                toolPos = {
                    x: this.currentPosition.x + offsetX,
                    y: this.currentPosition.y + offsetY,
                    z: this.currentPosition.z
                };
                
                console.log(`UpdateRotationHelper Compensation ${this.radiusCompensation}: radius=${this.currentTool.radius}, offset=(${offsetX.toFixed(2)}, ${offsetY.toFixed(2)})`);
            }
        }
        
        // Position the helper at tool position with transforms applied
        // toolPos is in CNC local space, need to transform to world space
        const worldPos = this.transformPoint(toolPos.x, toolPos.y, toolPos.z);
        this.rotationHelper.position.copy(worldPos);
        
        console.log(`Updating rotation helper: X=${this.currentRotation.x}° Y=${this.currentRotation.y}° Z=${this.currentRotation.z}°`);
        console.log(`Position (CNC): X=${this.currentPosition.x} Y=${this.currentPosition.y} Z=${this.currentPosition.z}`);
        console.log(`Tool Position (with comp): X=${toolPos.x} Y=${toolPos.y} Z=${toolPos.z}`);
        console.log(`Position (World): X=${worldPos.x} Y=${worldPos.y} Z=${worldPos.z}`);
        console.log(`Offset: X=${this.currentOffset.x} Y=${this.currentOffset.y} Z=${this.currentOffset.z}`);
        
        // Apply rotations to match CNC AROT behavior
        // Tool geometry points in correct direction by default (toward -Z)
        // AROT rotations must match the toolpath rotation matrix exactly
        //
        // Use same Euler order as updateRotationMatrix: 'ZYX'
        // This ensures tool orientation matches toolpath transformation
        
        this.rotationHelper.rotation.order = 'ZYX';
        this.rotationHelper.rotation.x = THREE.MathUtils.degToRad(this.currentRotation.x);
        this.rotationHelper.rotation.y = THREE.MathUtils.degToRad(this.currentRotation.z);  // CNC Z -> Three.js Y
        this.rotationHelper.rotation.z = THREE.MathUtils.degToRad(-this.currentRotation.y); // CNC Y -> Three.js -Z
        
        console.log(`Three.js rotation applied: X=${this.rotationHelper.rotation.x} Y=${this.rotationHelper.rotation.y} Z=${this.rotationHelper.rotation.z}`);
        
        this.scene.add(this.rotationHelper);
    }
    
    addDefaultToolIndicator() {
        // Default tool indicator (cone pointing down with cylinder shaft above)
        // The cone tip at y=0 is the cutting point
        const coneGeometry = new THREE.ConeGeometry(8, 20, 16);
        const coneMaterial = new THREE.MeshPhongMaterial({ 
            color: 0xff0000,
            transparent: true,
            opacity: 0.9
        });
        const cone = new THREE.Mesh(coneGeometry, coneMaterial);
        cone.position.set(0, 10, 0); // Tip at y=0, cone extends upward
        cone.rotation.x = Math.PI; // Flip 180° so point faces down
        this.rotationHelper.add(cone);
        
        const toolGeometry = new THREE.CylinderGeometry(5, 5, 60, 16);
        const toolMaterial = new THREE.MeshPhongMaterial({ 
            color: 0xff6600,
            transparent: true,
            opacity: 0.8
        });
        const tool = new THREE.Mesh(toolGeometry, toolMaterial);
        tool.position.set(0, 20 + 30, 0); // Above cone (cone top at y=20, cylinder 60 tall)
        this.rotationHelper.add(tool);
        this.rotationHelper.add(cone);
    }

    parseCoordinates(line, isAbsolute) {
        const newPos = { ...this.currentPosition };

        // Match coordinates with optional = sign (e.g., X100 or X=100)
        // Also support expressions like X=450-1
        const xMatch = line.match(/X=?([-+]?\d*\.?\d+(?:[-+]\d*\.?\d+)?)/);
        const yMatch = line.match(/Y=?([-+]?\d*\.?\d+(?:[-+]\d*\.?\d+)?)/);
        const zMatch = line.match(/Z=?([-+]?\d*\.?\d+(?:[-+]\d*\.?\d+)?)/);

        if (xMatch) {
            const value = this.evaluateExpression(xMatch[1]);
            newPos.x = isAbsolute ? value : this.currentPosition.x + value;
            console.log(`[parseCoordinates] X: ${xMatch[1]} = ${value}`);
        }
        if (yMatch) {
            const value = this.evaluateExpression(yMatch[1]);
            newPos.y = isAbsolute ? value : this.currentPosition.y + value;
            console.log(`[parseCoordinates] Y: ${yMatch[1]} = ${value}`);
        }
        if (zMatch) {
            const value = this.evaluateExpression(zMatch[1]);
            newPos.z = isAbsolute ? value : this.currentPosition.z + value;
            console.log(`[parseCoordinates] Z: ${zMatch[1]} = ${value}`);
        }

        return newPos;
    }

    evaluateExpression(expr) {
        // Safely evaluate simple arithmetic expressions like "450-1" or "100+5"
        try {
            // Remove any whitespace
            expr = expr.replace(/\s/g, '');
            // Only allow numbers, +, -, *, /, ., and parentheses for safety
            if (!/^[\d+\-*/.()]+$/.test(expr)) {
                console.warn(`[evaluateExpression] Invalid expression: ${expr}`);
                return parseFloat(expr);
            }
            // Use Function instead of eval for slightly better safety
            const result = new Function('return ' + expr)();
            console.log(`[evaluateExpression] ${expr} = ${result}`);
            return result;
        } catch (e) {
            console.error(`[evaluateExpression] Error evaluating "${expr}":`, e);
            return parseFloat(expr);
        }
    }

    parseArc(line, isAbsolute, isClockwise) {
        const endPos = this.parseCoordinates(line, isAbsolute);
        
        // Check for I, J, K (center offset) or R/CR (radius) format
        const iMatch = line.match(/I([-+]?\d*\.?\d+)/);
        const jMatch = line.match(/J([-+]?\d*\.?\d+)/);
        const kMatch = line.match(/K([-+]?\d*\.?\d+)/);
        const rMatch = line.match(/R=([-+]?\d*\.?\d+)/);  // Siemens CR= format
        const rMatch2 = line.match(/\bR([-+]?\d*\.?\d+)/); // Standard R format

        let center;
        
        if (rMatch || rMatch2) {
            // R/CR format: calculate center from radius
            const radius = parseFloat(rMatch ? rMatch[1] : rMatch2[1]);
            const dx = endPos.x - this.currentPosition.x;
            const dy = endPos.y - this.currentPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance === 0) {
                console.warn('Invalid arc: start and end positions are the same');
                return null;
            }
            
            if (Math.abs(radius) < distance / 2) {
                console.warn(`Invalid arc: radius ${radius} too small for distance ${distance}`);
                return null;
            }
            
            // Calculate center point (there are two possible centers, choose based on direction and radius sign)
            const h = Math.sqrt(radius * radius - (distance * distance) / 4);
            const midX = (this.currentPosition.x + endPos.x) / 2;
            const midY = (this.currentPosition.y + endPos.y) / 2;
            
            // Perpendicular direction
            const perpX = -(dy / distance);
            const perpY = dx / distance;
            
            // Choose center based on arc direction and radius sign
            // For Siemens: positive radius, direction determines which side
            const sign = isClockwise ? -1 : 1;
            
            center = {
                x: midX + sign * h * perpX,
                y: midY + sign * h * perpY,
                z: this.currentPosition.z
            };
        } else if (iMatch || jMatch || kMatch) {
            // I, J, K format: offset from start point
            const i = iMatch ? parseFloat(iMatch[1]) : 0;
            const j = jMatch ? parseFloat(jMatch[1]) : 0;
            const k = kMatch ? parseFloat(kMatch[1]) : 0;
            
            center = {
                x: this.currentPosition.x + i,
                y: this.currentPosition.y + j,
                z: this.currentPosition.z + k
            };
        } else {
            return null;
        }

        return {
            start: { ...this.currentPosition },
            end: endPos,
            center: center,
            clockwise: isClockwise
        };
    }
    
    applyRadiusCompensation(from, to) {
        // Apply G41/G42 tool radius compensation
        // G40 = no compensation, G41 = left of path, G42 = right of path
        
        if (this.radiusCompensation === 'G40' || !this.currentTool || !this.currentTool.radius) {
            return { from, to }; // No compensation
        }
        
        const radius = this.currentTool.radius;
        console.log(`Applying ${this.radiusCompensation} compensation with radius ${radius}`);
        
        // Calculate direction vector from 'from' to 'to'
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length < 0.001) {
            return { from, to }; // No movement, no compensation
        }
        
        // Normalize direction vector
        const nx = dx / length;
        const ny = dy / length;
        
        // Calculate perpendicular vector (90° rotation)
        // G41 (left): perpendicular is counter-clockwise rotation
        // G42 (right): perpendicular is clockwise rotation
        let perpX, perpY;
        if (this.radiusCompensation === 'G41') {
            // Left: rotate 90° counter-clockwise
            perpX = -ny;
            perpY = nx;
        } else { // G42
            // Right: rotate 90° clockwise
            perpX = ny;
            perpY = -nx;
        }
        
        // Apply offset
        const offsetFrom = {
            x: from.x + perpX * radius,
            y: from.y + perpY * radius,
            z: from.z
        };
        
        const offsetTo = {
            x: to.x + perpX * radius,
            y: to.y + perpY * radius,
            z: to.z
        };
        
        console.log(`Original: from(${from.x},${from.y}) to(${to.x},${to.y})`);
        console.log(`Compensated: from(${offsetFrom.x},${offsetFrom.y}) to(${offsetTo.x},${offsetTo.y})`);
        
        return { from: offsetFrom, to: offsetTo };
    }

    addRapidMove(from, to) {
        // Convert CNC coordinates to Three.js and apply current rotation transformation
        const fromVec = this.transformPoint(from.x, from.y, from.z);
        const toVec = this.transformPoint(to.x, to.y, to.z);
        
        this.rapidPoints.push(fromVec, toVec);
    }

    addCuttingMove(from, to) {
        // Convert CNC coordinates to Three.js and apply current rotation transformation
        // Note: NO radius compensation here - toolpath shows the programmed path
        const fromVec = this.transformPoint(from.x, from.y, from.z);
        const toVec = this.transformPoint(to.x, to.y, to.z);
        
        this.toolpathPoints.push(fromVec, toVec);
    }
    
    // Helper function to calculate simple offset (when only one movement is available)
    calculateSimpleOffset(step, position, radius, compensation, useStart) {
        // Calculate direction at the position
        let dx, dy;
        
        if (step.command === 'G2' || step.command === 'G3') {
            // Arc: calculate tangent
            const center = step.center;
            if (!center) return position;
            
            const rx = position.x - center.x;
            const ry = position.y - center.y;
            
            if (step.command === 'G3') {
                dx = ry;
                dy = -rx;
            } else {
                dx = -ry;
                dy = rx;
            }
        } else {
            // Linear: use line direction
            dx = step.to.x - step.from.x;
            dy = step.to.y - step.from.y;
        }
        
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.0001) return position;
        
        const nx = dx / len;
        const ny = dy / len;
        
        // Calculate perpendicular offset
        let offsetX, offsetY;
        if (compensation === 'G41') {
            offsetX = -ny * radius;
            offsetY = nx * radius;
        } else {
            offsetX = ny * radius;
            offsetY = -nx * radius;
        }
        
        return {
            x: position.x + offsetX,
            y: position.y + offsetY,
            z: position.z
        };
    }
    
    // Helper function to calculate intersection of two offset paths
    calculateCompensationIntersection(prevStep, nextStep, position, radius, compensation) {
        // Get direction/tangent at end of previous step
        let prev_dx, prev_dy;
        if (prevStep.command === 'G2' || prevStep.command === 'G3') {
            const center = prevStep.center;
            if (!center) return this.calculateSimpleOffset(nextStep, position, radius, compensation, true);
            
            const rx = position.x - center.x;
            const ry = position.y - center.y;
            
            if (prevStep.command === 'G3') {
                prev_dx = ry;
                prev_dy = -rx;
            } else {
                prev_dx = -ry;
                prev_dy = rx;
            }
        } else {
            prev_dx = prevStep.to.x - prevStep.from.x;
            prev_dy = prevStep.to.y - prevStep.from.y;
        }
        
        // Get direction/tangent at start of next step
        let next_dx, next_dy;
        if (nextStep.command === 'G2' || nextStep.command === 'G3') {
            const center = nextStep.center;
            if (!center) return this.calculateSimpleOffset(prevStep, position, radius, compensation, false);
            
            const rx = position.x - center.x;
            const ry = position.y - center.y;
            
            if (nextStep.command === 'G3') {
                next_dx = ry;
                next_dy = -rx;
            } else {
                next_dx = -ry;
                next_dy = rx;
            }
        } else {
            next_dx = nextStep.to.x - nextStep.from.x;
            next_dy = nextStep.to.y - nextStep.from.y;
        }
        
        // Normalize directions
        const prev_len = Math.sqrt(prev_dx * prev_dx + prev_dy * prev_dy);
        const next_len = Math.sqrt(next_dx * next_dx + next_dy * next_dy);
        
        if (prev_len < 0.0001 || next_len < 0.0001) {
            return this.calculateSimpleOffset(nextStep, position, radius, compensation, true);
        }
        
        const prev_nx = prev_dx / prev_len;
        const prev_ny = prev_dy / prev_len;
        const next_nx = next_dx / next_len;
        const next_ny = next_dy / next_len;
        
        // Calculate perpendicular offsets for both segments
        let prev_offsetX, prev_offsetY, next_offsetX, next_offsetY;
        if (compensation === 'G41') {
            prev_offsetX = -prev_ny * radius;
            prev_offsetY = prev_nx * radius;
            next_offsetX = -next_ny * radius;
            next_offsetY = next_nx * radius;
        } else {
            prev_offsetX = prev_ny * radius;
            prev_offsetY = -prev_nx * radius;
            next_offsetX = next_ny * radius;
            next_offsetY = -next_nx * radius;
        }
        
        // Calculate offset lines
        // Previous segment offset line passes through (position + prev_offset) in direction (prev_nx, prev_ny)
        // Next segment offset line passes through (position + next_offset) in direction (next_nx, next_ny)
        
        const p1x = position.x + prev_offsetX;
        const p1y = position.y + prev_offsetY;
        const p2x = position.x + next_offsetX;
        const p2y = position.y + next_offsetY;
        
        // Line intersection: find where two lines meet
        // Line 1: (p1x, p1y) + t * (prev_nx, prev_ny)
        // Line 2: (p2x, p2y) + s * (next_nx, next_ny)
        
        const det = prev_nx * next_ny - prev_ny * next_nx;
        
        if (Math.abs(det) < 0.0001) {
            // Lines are parallel - use average of offsets
            return {
                x: position.x + (prev_offsetX + next_offsetX) / 2,
                y: position.y + (prev_offsetY + next_offsetY) / 2,
                z: position.z
            };
        }
        
        // Calculate angle between the two directions using cross product
        // If cross product is positive, it's a left turn (< 180°)
        // If negative, it's a right turn (> 180°)
        const cross = prev_nx * next_ny - prev_ny * next_nx;
        
        // For G41 (left compensation), inside corners have positive cross product
        // For G42 (right compensation), inside corners have negative cross product
        const isInsideCorner = (compensation === 'G41' && cross > 0) || 
                               (compensation === 'G42' && cross < 0);
        
        if (isInsideCorner) {
            // Inside corner (< 180°): offset lines intersect, use intersection point
            const t = ((p2x - p1x) * next_ny - (p2y - p1y) * next_nx) / det;
            
            return {
                x: p1x + t * prev_nx,
                y: p1y + t * prev_ny,
                z: position.z
            };
        } else {
            // Outside corner (> 180°): offset lines diverge, need to create an arc
            // Calculate the arc center point between the two offset positions
            // The arc length is the distance between the two offset points
            // The tool center is at arc_length / 2 along the arc
            
            // For now, use a simple approach: bisector of the angle
            // The bisector is the average of the two normalized directions
            const bisector_x = (prev_nx + next_nx) / 2;
            const bisector_y = (prev_ny + next_ny) / 2;
            const bisector_len = Math.sqrt(bisector_x * bisector_x + bisector_y * bisector_y);
            
            if (bisector_len < 0.0001) {
                // 180° turn - use average offset
                return {
                    x: position.x + (prev_offsetX + next_offsetX) / 2,
                    y: position.y + (prev_offsetY + next_offsetY) / 2,
                    z: position.z
                };
            }
            
            const bisector_nx = bisector_x / bisector_len;
            const bisector_ny = bisector_y / bisector_len;
            
            // Calculate distance along bisector to maintain radius distance from corner
            // Using geometry: distance = radius / sin(angle/2)
            const dot = prev_nx * next_nx + prev_ny * next_ny; // cos(angle)
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            const half_angle = angle / 2;
            const bisector_dist = Math.abs(radius / Math.sin(half_angle));
            
            return {
                x: position.x + bisector_nx * bisector_dist,
                y: position.y + bisector_ny * bisector_dist,
                z: position.z
            };
        }
    }
    
    transformPoint(x, y, z) {
        // Create a vector in CNC local coordinate system
        // When the tool is rotated (AROT), X/Y/Z movements are in the tool's local frame
        // We need to transform them to world coordinates
        
        // Start with movement in local tool coordinates
        // In CNC: X=length, Y=width, Z=depth (positive=retract, negative=plunge)
        const localVector = new THREE.Vector3(x, z, -y);
        
        // Apply the rotation transformation to convert from tool space to world space
        localVector.applyMatrix4(this.rotationMatrix);
        
        // Apply offset (TRANS command shifts the origin)
        localVector.x += this.currentOffset.x;
        localVector.y += this.currentOffset.z; // CNC Z -> Three.js Y
        localVector.z += -this.currentOffset.y; // CNC Y -> Three.js -Z
        
        return localVector;
    }

    addArcMove(arcData, isClockwise) {
        const { start, end, center } = arcData;
        
        console.log('Adding arc:', { start, end, center, isClockwise });
        
        // Calculate radius from start point
        const radius = Math.sqrt(
            Math.pow(start.x - center.x, 2) +
            Math.pow(start.y - center.y, 2)
        );

        // Calculate start and end angles
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

        // Calculate angle difference and ensure correct direction
        let angleDiff = endAngle - startAngle;

        if (isClockwise) {
            // G2 - clockwise: angle should decrease
            while (angleDiff > 0) angleDiff -= 2 * Math.PI;
        } else {
            // G3 - counter-clockwise: angle should increase
            while (angleDiff < 0) angleDiff += 2 * Math.PI;
        }

        // Generate smooth arc with enough segments
        const arcLength = Math.abs(angleDiff * radius);
        const segments = Math.max(20, Math.ceil(arcLength / 5)); // At least 20 segments, or 1 per 5 units
        
        console.log(`Arc: radius=${radius.toFixed(2)}, angleDiff=${(angleDiff * 180 / Math.PI).toFixed(1)}°, segments=${segments}`);
        
        // Store previous point for line segments
        let prevPoint = this.transformPoint(start.x, start.y, start.z);
        
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const angle = startAngle + (angleDiff * t);
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            const z = start.z + (end.z - start.z) * t;

            const currentPoint = this.transformPoint(x, y, z);
            
            // Add line segment from previous point to current point
            this.toolpathPoints.push(prevPoint, currentPoint);
            prevPoint = currentPoint;
        }
        
        console.log(`Added ${segments} arc segments, total toolpath points: ${this.toolpathPoints.length}`);
    }

    renderToolpath() {
        // Render cutting moves (solid green line) - use Line for continuous path
        if (this.toolpathPoints.length > 0) {
            const geometry = new THREE.BufferGeometry().setFromPoints(this.toolpathPoints);
            const material = new THREE.LineBasicMaterial({ 
                color: 0x00ff00,
                linewidth: 2
            });
            // Use LineSegments since we're adding point pairs
            this.toolpath = new THREE.LineSegments(geometry, material);
            this.scene.add(this.toolpath);
        }

        // Render rapid moves (dashed red line)
        if (this.rapidPoints.length > 0) {
            const geometry = new THREE.BufferGeometry().setFromPoints(this.rapidPoints);
            const material = new THREE.LineDashedMaterial({ 
                color: 0xff4444,
                linewidth: 1,
                dashSize: 3,
                gapSize: 2
            });
            this.rapidMoves = new THREE.LineSegments(geometry, material);
            this.rapidMoves.computeLineDistances();
            this.scene.add(this.rapidMoves);
        }
    }
    
    addDoorOutline(params) {
        console.log('Adding door outline with params:', params);
        
        // Remove existing outline
        if (this.doorOutline) {
            this.scene.remove(this.doorOutline);
            if (this.doorOutline.userData.surface) {
                this.scene.remove(this.doorOutline.userData.surface);
                this.doorOutline.userData.surface.geometry.dispose();
                this.doorOutline.userData.surface.material.dispose();
            }
            this.doorOutline.geometry.dispose();
            this.doorOutline.material.dispose();
        }
        
        // Create door outline box
        const length = params.length || 2000;
        const width = params.width || 800;
        const thickness = params.thickness || 40;
        
        console.log(`Creating door box: ${length} x ${width} x ${thickness}`);
        
        // Create edges geometry for the door
        const geometry = new THREE.BoxGeometry(length, thickness, width);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ 
            color: 0x4444ff,
            linewidth: 3
        });
        
        this.doorOutline = new THREE.LineSegments(edges, material);
        
        // Position the door outline - center at origin on XY plane, Z at half width
        this.doorOutline.position.set(length / 2, thickness / 2, -width / 2);
        
        this.scene.add(this.doorOutline);
        console.log('Door outline added to scene at position:', this.doorOutline.position);
        
        // Also add a semi-transparent door surface
        const surfaceMaterial = new THREE.MeshBasicMaterial({
            color: 0x8b7355,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        const doorSurface = new THREE.Mesh(geometry, surfaceMaterial);
        doorSurface.position.copy(this.doorOutline.position);
        this.scene.add(doorSurface);
        this.doorOutline.userData.surface = doorSurface;
        
        console.log('Door surface added');
    }

    fitCameraToObject() {
        if (this.toolpathPoints.length === 0 && this.rapidPoints.length === 0) return;

        // Calculate bounding box
        const allPoints = [...this.toolpathPoints, ...this.rapidPoints];
        const box = new THREE.Box3().setFromPoints(allPoints);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Set camera position
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5; // Add some margin

        this.camera.position.set(center.x + cameraZ, center.y + cameraZ, center.z + cameraZ);
        this.camera.lookAt(center);
        this.controls.target.copy(center);
        this.controls.update();
    }

    showStats(gcode) {
        const lines = gcode.split('\n').filter(l => l.trim());
        const rapidMoves = lines.filter(l => l.toUpperCase().includes('G0') || l.toUpperCase().includes('G00')).length;
        const linearMoves = lines.filter(l => l.toUpperCase().includes('G1') || l.toUpperCase().includes('G01')).length;
        const arcMoves = lines.filter(l => {
            const upper = l.toUpperCase();
            return upper.includes('G2') || upper.includes('G02') || upper.includes('G3') || upper.includes('G03');
        }).length;
        const rotationMoves = lines.filter(l => l.toUpperCase().includes('AROT') || l.toUpperCase().includes('TRAFOOF')).length;
        const translationMoves = lines.filter(l => l.toUpperCase().includes('TRANS') && !l.toUpperCase().includes('TRAFOOF')).length;

        return {
            totalLines: lines.length,
            rapidMoves,
            linearMoves,
            arcMoves,
            rotationMoves,
            translationMoves,
            toolpathPoints: this.toolpathPoints.length / 2,
            rapidPoints: this.rapidPoints.length / 2,
            totalSteps: this.animationSteps.length
        };
    }
    
    // Animation controls
    startAnimation() {
        this.isAnimating = true;
        // Don't reset currentStepIndex - continue from current position
        // Only clear and restart if already at the end
        if (this.currentStepIndex >= this.animationSteps.length) {
            this.currentStepIndex = 0;
            this.clearRenderedToolpath();
        }
        this.animateNextStep();
    }
    
    stopAnimation() {
        this.isAnimating = false;
    }
    
    animateNextStep() {
        if (!this.isAnimating || this.currentStepIndex >= this.animationSteps.length) {
            this.isAnimating = false;
            this.updateAnimationUI(this.currentStepIndex, this.animationSteps.length, null);
            return;
        }
        
        const step = this.animationSteps[this.currentStepIndex];
        console.log(`Step ${this.currentStepIndex + 1}/${this.animationSteps.length}:`, step);
        
        // Render up to current step
        this.renderUpToStep(this.currentStepIndex);
        
        // Update UI with current step info
        this.updateAnimationUI(this.currentStepIndex, this.animationSteps.length, step);
        
        this.currentStepIndex++;
        
        setTimeout(() => this.animateNextStep(), this.animationSpeed);
    }
    
    stepForward() {
        if (this.currentStepIndex < this.animationSteps.length) {
            const step = this.animationSteps[this.currentStepIndex];
            console.log(`Step ${this.currentStepIndex + 1}/${this.animationSteps.length}:`, step);
            
            this.renderUpToStep(this.currentStepIndex);
            this.updateAnimationUI(this.currentStepIndex, this.animationSteps.length, step);
            this.currentStepIndex++;
        }
    }
    
    stepBackward() {
        if (this.currentStepIndex > 0) {
            this.currentStepIndex--;
            const step = this.animationSteps[this.currentStepIndex];
            console.log(`Step ${this.currentStepIndex + 1}/${this.animationSteps.length}:`, step);
            
            this.renderUpToStep(this.currentStepIndex - 1);
            this.updateAnimationUI(this.currentStepIndex, this.animationSteps.length, step);
        }
    }
    
    resetAnimation() {
        this.currentStepIndex = 0;
        this.isAnimating = false;
        this.clearRenderedToolpath();
        this.updateAnimationUI(0, this.animationSteps.length, null);
    }

    setAnimationSpeed(speed) {
        this.animationSpeed = speed;
        localStorage.setItem('cncAnimationSpeed', speed);
        console.log(`Animation speed set to ${speed} ms`);
    }
    
    clearRenderedToolpath() {
        // Remove all objects from scene except axes, lights, door, and tool
        const objectsToRemove = [];
        this.scene.traverse((object) => {
            // Check if object is the door outline or its surface
            const isDoorObject = (object === this.doorOutline) || 
                                 (this.doorOutline && this.doorOutline.userData.surface === object);
            
            // Check if object is the tool or part of the tool group
            const isToolObject = (object === this.rotationHelper) || 
                                 (this.rotationHelper && this.rotationHelper.children.includes(object));
            
            if (object !== this.scene && 
                object !== this.axes && 
                !isDoorObject &&
                !isToolObject &&
                object.type !== 'AmbientLight' && 
                object.type !== 'DirectionalLight') {
                objectsToRemove.push(object);
            }
        });
        
        objectsToRemove.forEach((object) => {
            this.scene.remove(object);
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
        });
        
        this.toolpath = null;
        this.rapidMoves = null;
    }
    
    renderUpToStep(stepIndex) {
        // Clear current rendering
        this.clearRenderedToolpath();
        
        const cuttingPoints = [];
        const rapidPoints = [];
        let lastMovementStep = null;
        
        // Render all steps up to stepIndex
        for (let i = 0; i <= stepIndex && i < this.animationSteps.length; i++) {
            const step = this.animationSteps[i];
            
            // Handle rotation commands (AROT)
            if (step.isRotation && step.from && step.to) {
                this.currentRotation = step.to;
                this.updateRotationMatrix();
                continue;
            }
            
            // Handle translation commands (TRANS)
            if (step.isTranslation && step.from && step.to) {
                this.currentOffset = step.to;
                continue;
            }
            
            // Handle reset commands (TRAFOOF)
            if (step.isReset) {
                this.currentRotation = step.toRotation || { x: 0, y: 0, z: 0 };
                this.currentOffset = step.toOffset || { x: 0, y: 0, z: 0 };
                this.updateRotationMatrix();
                continue;
            }
            
            // Handle tool changes
            if (step.command === 'TOOL_CHANGE' || step.command === 'OFFSET_CHANGE') {
                this.currentTool = step.tool;
                this.currentPL = step.pl;
                this.currentD = step.d;
                console.log(`[renderUpToStep] Tool change: PL=${step.pl}, D=${step.d}, Tool:`, step.tool);
                
                // If there's a movement to safe Z, draw it
                if (step.from && step.to && step.safeZ) {
                    const fromWorld = this.transformPoint(step.from.x, step.from.y, step.from.z);
                    const toWorld = this.transformPoint(step.to.x, step.to.y, step.to.z);
                    
                    const points = [
                        new THREE.Vector3(fromWorld.x, fromWorld.y, fromWorld.z),
                        new THREE.Vector3(toWorld.x, toWorld.y, toWorld.z)
                    ];
                    
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({ color: 0xffff00 }); // Yellow for tool change
                    const line = new THREE.Line(geometry, material);
                    this.scene.add(line);
                    
                    this.currentPosition.z = step.safeZ;
                    console.log(`[renderUpToStep] Tool moved to safe Z position: ${step.safeZ}`);
                }
                
                continue;
            }
            
            // Apply radius compensation state from step (G40/G41/G42)
            if (step.radiusCompensation) {
                this.radiusCompensation = step.radiusCompensation;
            }
            
            // Handle arc moves (G2/G3)
            if (step.arcData) {
                const { start, end, center } = step.arcData;
                const isClockwise = step.command === 'G2';
                
                // Calculate arc points
                const radius = Math.sqrt(
                    Math.pow(start.x - center.x, 2) +
                    Math.pow(start.y - center.y, 2)
                );
                
                const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
                const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
                
                let angleDiff = endAngle - startAngle;
                if (isClockwise) {
                    while (angleDiff > 0) angleDiff -= 2 * Math.PI;
                } else {
                    while (angleDiff < 0) angleDiff += 2 * Math.PI;
                }
                
                const arcLength = Math.abs(angleDiff * radius);
                const segments = Math.max(20, Math.ceil(arcLength / 5));
                
                let prevPoint = this.transformPoint(start.x, start.y, start.z);
                
                for (let j = 1; j <= segments; j++) {
                    const t = j / segments;
                    const angle = startAngle + (angleDiff * t);
                    const x = center.x + radius * Math.cos(angle);
                    const y = center.y + radius * Math.sin(angle);
                    const z = start.z + (end.z - start.z) * t;
                    
                    const currentPoint = this.transformPoint(x, y, z);
                    cuttingPoints.push(prevPoint, currentPoint);
                    prevPoint = currentPoint;
                }
                
                // Track this as last movement
                lastMovementStep = { from: start, to: end };
            } else if (step.from && step.to) {
                // Handle linear moves (G0/G1)
                const from = this.transformPoint(step.from.x, step.from.y, step.from.z);
                const to = this.transformPoint(step.to.x, step.to.y, step.to.z);
                
                if (step.isRapid) {
                    rapidPoints.push(from, to);
                } else {
                    cuttingPoints.push(from, to);
                }
                
                // Track this as last movement
                lastMovementStep = { from: step.from, to: step.to };
            }
        }
        
        // Update position tracking based on last movement
        if (lastMovementStep) {
            this.previousPosition = { ...lastMovementStep.from };
            this.currentPosition = { ...lastMovementStep.to };
            console.log(`[renderUpToStep] Updated currentPosition from lastMovementStep: (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
        } else {
            console.log(`[renderUpToStep] No movement steps found, currentPosition remains: (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
        }
        
        // Update/create tool indicator if needed (only if we have a valid tool)
        // Create rotation helper if it doesn't exist OR if tool has changed
        if (!this.rotationHelper || this.rotationHelper._currentToolId !== (this.currentTool ? `${this.currentPL}_${this.currentD}` : null)) {
            this.updateRotationHelper();
            if (this.rotationHelper) {
                this.rotationHelper._currentToolId = this.currentTool ? `${this.currentPL}_${this.currentD}` : null;
            }
        }
        
        if (this.rotationHelper) {
            let toolPos = { ...this.currentPosition };
            
            console.log(`[renderUpToStep] Starting compensation check: comp=${this.radiusCompensation}, tool=${this.currentTool ? this.currentTool.name : 'none'}, radius=${this.currentTool ? this.currentTool.radius : 'N/A'}`);
            
            if (this.radiusCompensation !== 'G40' && this.currentTool && this.currentTool.radius) {
                // Tool radius compensation requires calculating intersection of offset paths
                // We need both the PREVIOUS and NEXT movement to calculate the intersection point
                
                const prevStep = lastMovementStep;
                let nextStep = null;
                
                // Find next movement step with XY motion
                for (let i = stepIndex + 1; i < this.animationSteps.length; i++) {
                    const step = this.animationSteps[i];
                    if (step.from && step.to) {
                        const dx = step.to.x - step.from.x;
                        const dy = step.to.y - step.from.y;
                        const xyLen = Math.sqrt(dx * dx + dy * dy);
                        
                        if (xyLen > 0.0001) {
                            nextStep = step;
                            break;
                        }
                    }
                }
                
                console.log(`[renderUpToStep] Compensation: prev=${prevStep?.command}, next=${nextStep?.command}`);
                
                if (prevStep && nextStep) {
                    // Calculate the tool center position as intersection of offset paths
                    toolPos = this.calculateCompensationIntersection(prevStep, nextStep, this.currentPosition, this.currentTool.radius, this.radiusCompensation);
                } else if (prevStep) {
                    // Only previous movement available, use simple offset
                    toolPos = this.calculateSimpleOffset(prevStep, this.currentPosition, this.currentTool.radius, this.radiusCompensation, false);
                } else if (nextStep) {
                    // Only next movement available, use simple offset
                    toolPos = this.calculateSimpleOffset(nextStep, this.currentPosition, this.currentTool.radius, this.radiusCompensation, true);
                }
                
                if (toolPos && (toolPos.x !== this.currentPosition.x || toolPos.y !== this.currentPosition.y)) {
                    // Visual debug: Draw line from toolpath to tool center to show offset
                    const toolpathWorld = this.transformPoint(this.currentPosition.x, this.currentPosition.y, this.currentPosition.z);
                    const toolCenterWorld = this.transformPoint(toolPos.x, toolPos.y, toolPos.z);
                    const debugLine = new THREE.BufferGeometry().setFromPoints([toolpathWorld, toolCenterWorld]);
                    const debugMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 }); // Yellow line
                    const debugOffset = new THREE.Line(debugLine, debugMaterial);
                    this.scene.add(debugOffset);
                    
                    console.log(`[renderUpToStep] Tool compensation applied: toolpath=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}), toolCenter=(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)})`);
                }
            }
            
            if (!toolPos) {
                toolPos = { ...this.currentPosition };
            }
            
            const worldPos = this.transformPoint(toolPos.x, toolPos.y, toolPos.z);
            this.rotationHelper.position.copy(worldPos);
            
            // Update tool rotation to match current AROT
            this.rotationHelper.rotation.order = 'ZYX';
            this.rotationHelper.rotation.x = THREE.MathUtils.degToRad(this.currentRotation.x);
            this.rotationHelper.rotation.y = THREE.MathUtils.degToRad(this.currentRotation.z);
            this.rotationHelper.rotation.z = THREE.MathUtils.degToRad(-this.currentRotation.y);
            
            console.log(`[renderUpToStep] Final tool position - CNC:(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)}, ${toolPos.z.toFixed(2)}) World:(${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})`);
        }
        
        // Render cutting moves
        if (cuttingPoints.length > 0) {
            const geometry = new THREE.BufferGeometry().setFromPoints(cuttingPoints);
            const material = new THREE.LineBasicMaterial({ 
                color: 0x00ff00,
                linewidth: 2
            });
            this.toolpath = new THREE.LineSegments(geometry, material);
            this.scene.add(this.toolpath);
        }
        
        // Render rapid moves
        if (rapidPoints.length > 0) {
            const geometry = new THREE.BufferGeometry().setFromPoints(rapidPoints);
            const material = new THREE.LineDashedMaterial({ 
                color: 0xff4444,
                linewidth: 1,
                dashSize: 3,
                gapSize: 2
            });
            this.rapidMoves = new THREE.LineSegments(geometry, material);
            this.rapidMoves.computeLineDistances();
            this.scene.add(this.rapidMoves);
        }
    }
    
    // Update animation UI
    updateAnimationUI(currentStep, totalSteps, stepData) {
        const animInfoDiv = document.getElementById('animationInfo');
        if (!animInfoDiv) return;
        
        if (stepData) {
            let html = `
                <div class="anim-step"><strong>Step ${currentStep + 1}/${totalSteps}</strong></div>
                <div class="anim-line"><strong>Lijn ${stepData.lineNumber}:</strong> ${stepData.originalLine}</div>
                <div class="anim-cmd"><strong>Command:</strong> ${stepData.command}`;
            
            // Handle tool changes
            if (stepData.command === 'TOOL_CHANGE') {
                html += `</div>
                <div class="anim-info"><strong>Gereedschap:</strong> ${stepData.description}</div>`;
            }
            // Handle TRANS (origin offset)
            else if (stepData.isTranslation && stepData.from && stepData.to) {
                html += ` (Nulpunt verschuiving)</div>
                <div class="anim-pos"><strong>Van:</strong> X${stepData.from.x.toFixed(1)} Y${stepData.from.y.toFixed(1)} Z${stepData.from.z.toFixed(1)}</div>
                <div class="anim-pos"><strong>Naar:</strong> X${stepData.to.x.toFixed(1)} Y${stepData.to.y.toFixed(1)} Z${stepData.to.z.toFixed(1)}</div>`;
            }
            // Handle TRAFOOF (reset transformation)
            else if (stepData.isReset) {
                html += ` (Reset)</div>`;
                if (stepData.fromRotation && (stepData.fromRotation.x !== 0 || stepData.fromRotation.y !== 0 || stepData.fromRotation.z !== 0)) {
                    html += `<div class="anim-info">Rotatie gereset: X${stepData.fromRotation.x.toFixed(1)}° Y${stepData.fromRotation.y.toFixed(1)}° Z${stepData.fromRotation.z.toFixed(1)}° → 0°</div>`;
                }
                if (stepData.fromOffset && (stepData.fromOffset.x !== 0 || stepData.fromOffset.y !== 0 || stepData.fromOffset.z !== 0)) {
                    html += `<div class="anim-info">Offset gereset: X${stepData.fromOffset.x.toFixed(1)} Y${stepData.fromOffset.y.toFixed(1)} Z${stepData.fromOffset.z.toFixed(1)} → 0</div>`;
                }
            }
            // Different display for rotation vs movement commands
            else if (stepData.isRotation && stepData.from && stepData.to) {
                html += ` (Rotatie)</div>
                <div class="anim-pos"><strong>Van:</strong> X${stepData.from.x.toFixed(1)}° Y${stepData.from.y.toFixed(1)}° Z${stepData.from.z.toFixed(1)}°</div>
                <div class="anim-pos"><strong>Naar:</strong> X${stepData.to.x.toFixed(1)}° Y${stepData.to.y.toFixed(1)}° Z${stepData.to.z.toFixed(1)}°</div>
                <div class="anim-info" style="margin-top: 5px; font-size: 0.9em; color: #888;">
                    X = zijdelingse rotatie, Z+ = van werkstuk weg, Z- = in werkstuk
                </div>`;
            } else if (stepData.from && stepData.to) {
                html += ` ${stepData.isRapid ? '(Rapid)' : '(Cut)'}</div>
                <div class="anim-pos"><strong>Van:</strong> X${stepData.from.x.toFixed(2)} Y${stepData.from.y.toFixed(2)} Z${stepData.from.z.toFixed(2)}</div>
                <div class="anim-pos"><strong>Naar:</strong> X${stepData.to.x.toFixed(2)} Y${stepData.to.y.toFixed(2)} Z${stepData.to.z.toFixed(2)}</div>`;
            } else {
                html += `</div>`;
            }
            
            animInfoDiv.innerHTML = html;
            
            // Highlight the corresponding line in the code viewer
            if (stepData.lineNumber && window.highlightCodeLine) {
                window.highlightCodeLine(stepData.lineNumber);
            }
        } else {
            animInfoDiv.innerHTML = `<div class="anim-step">Selecteer een stap met de knoppen hieronder</div>`;
        }
    }
}

// Global viewer instance - export for use in app.js
export let cncViewer = null;

// Initialize viewer when DOM is ready
export function initViewer() {
    if (!cncViewer) {
        cncViewer = new CNCViewer('viewer3d');
    }
    return cncViewer;
}

// Parse and display G-code
export function visualizeGCode(gcode, parameters) {
    if (!cncViewer) {
        initViewer();
    }
    
    // Parse G-code first
    cncViewer.parseGCode(gcode);
    
    // Add door outline if parameters are available
    if (parameters && (parameters.length || parameters.width || parameters.thickness)) {
        cncViewer.addDoorOutline(parameters);
    }
    
    const stats = cncViewer.showStats(gcode);
    
    // Add parameters to stats for display
    if (parameters) {
        stats.doorParams = parameters;
    }
    
    updateViewerStats(stats);
}

// Update statistics display
function updateViewerStats(stats) {
    const statsContent = document.getElementById('statsContent');
    if (statsContent) {
        let html = `
            <div class="stat-item"><strong>Totaal regels:</strong> ${stats.totalLines}</div>
            <div class="stat-item"><strong>Rapid moves (G0):</strong> ${stats.rapidMoves}</div>
            <div class="stat-item"><strong>Lineair (G1):</strong> ${stats.linearMoves}</div>
            <div class="stat-item"><strong>Bogen (G2/G3):</strong> ${stats.arcMoves}</div>`;
        
        if (stats.rotationMoves > 0) {
            html += `<div class="stat-item"><strong>Rotaties (AROT/TRAFOOF):</strong> ${stats.rotationMoves}</div>`;
        }
        
        if (stats.translationMoves > 0) {
            html += `<div class="stat-item"><strong>Verschuivingen (TRANS):</strong> ${stats.translationMoves}</div>`;
        }
        
        html += `
            <div class="stat-item"><strong>Toolpath punten:</strong> ${stats.toolpathPoints}</div>
            <div class="stat-item"><strong>Bewegingen:</strong> ${stats.totalSteps}</div>
        `;
        
        statsContent.innerHTML = html;
    }
}

// Clear viewer
export function clearViewer() {
    if (cncViewer) {
        cncViewer.clear();
    }
    const statsContent = document.getElementById('statsContent');
    if (statsContent) {
        statsContent.innerHTML = '';
    }
}
