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
        this.lastToolXY = null; // Last compensated tool XY position (for Z-only movements)
        this.currentRotation = { x: 0, y: 0, z: 0 }; // Siemens 840D AROT rotations
        this.currentOffset = { x: 0, y: 0, z: 0 }; // Siemens 840D TRANS offset (origin shift)
        this.rotationMatrix = new THREE.Matrix4(); // Transformation matrix for rotated coordinate system
        // Local variable definitions from DEF statements and runtime variable values
        this.localVariableDefs = {}; // { NAME: { type: 'REAL'|'INT'|'STRING', length: n|null } }
        this.localVariables = {}; // { "$NAME": "value" }
        this.currentTool = null; // Current active tool (PL+D combination)
        this.currentPL = null; // Current PL (plaats) number
        this.currentD = null; // Current D number
        this.toolpathPoints = [];
        this.rapidPoints = [];
        this.doorOutline = null;
        this.rotationHelper = null; // Visual indicator for current rotation
        this.partialLine = null; // Partial line during smooth animation

        // Debug flag
        this.verboseLogging = false; // Set to true for detailed console logs

        // Animation properties
        this.animationSteps = [];
        this.currentStepIndex = 0;
        this.isAnimating = false;
        this.animationSpeed = parseInt(localStorage.getItem('cncAnimationSpeed')) || 100; // ms per step, saved in localStorage
        this.currentFeedrate = 0; // Current feedrate in mm/min
        this.maxRapidFeedrate = parseFloat(localStorage.getItem('maxRapidFeedrate')) || 50000; // Max feedrate for G0
        this.useRealisticSpeed = true; // Use realistic feedrate-based animation

        // Recording properties
        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordingFormat = null;

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
        this.controls.enableDamping = false;
        this.controls.dampingFactor = 0.01;
        this.controls.minDistance = 0; // Minimum zoom distance
        this.controls.maxDistance = 5000; // Maximum zoom distance
        this.controls.zoomSpeed = 1.8; // Responsive zoom speed
        this.controls.panSpeed = 1; // Pan speed
        this.controls.rotateSpeed = 1; // Rotation speed

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
        this.updateCameraInfo();
    }

    updateCameraInfo() {
        const animInfoDiv = document.getElementById('animationInfo');
        if (!animInfoDiv) return;

        const pos = this.camera.position;
        const target = this.controls.target;
        const distance = pos.distanceTo(target);

        const cameraInfoDiv = animInfoDiv.querySelector('.camera-info');
        if (cameraInfoDiv) {
            cameraInfoDiv.innerHTML = `
                <strong>Camera:</strong> X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}<br>
                <strong>Target:</strong> X: ${target.x.toFixed(1)}, Y: ${target.y.toFixed(1)}, Z: ${target.z.toFixed(1)}<br>
                <strong>Afstand:</strong> ${distance.toFixed(1)}
            `;
        } else {
            // Create camera info div if it doesn't exist
            const newCameraInfo = document.createElement('div');
            newCameraInfo.className = 'camera-info';
            newCameraInfo.style.cssText = 'position: absolute; top: 5px; right: 10px; font-size: 0.75em; color: #888; text-align: right; line-height: 1.3; background: rgba(0,0,0,0.5); padding: 5px 8px; border-radius: 4px;';
            newCameraInfo.innerHTML = `
                <strong>Camera:</strong> X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}<br>
                <strong>Target:</strong> X: ${target.x.toFixed(1)}, Y: ${target.y.toFixed(1)}, Z: ${target.z.toFixed(1)}<br>
                <strong>Afstand:</strong> ${distance.toFixed(1)}
            `;
            animInfoDiv.appendChild(newCameraInfo);
        }
    }

    onWindowResize() {
        if (!this.container) return;

        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    // Start recording
    startRecording(format) {
        if (this.isRecording) return;

        this.recordingFormat = format;
        this.recordedChunks = [];
        this.isRecording = true;

        const canvas = this.renderer.domElement;
        const stream = canvas.captureStream(30); // 30 fps

        // Set up MediaRecorder with appropriate codec
        let options;
        if (format === 'mp4') {
            options = { mimeType: 'video/webm;codecs=vp9' }; // Will convert to mp4
        } else if (format === 'avi') {
            options = { mimeType: 'video/webm;codecs=vp8' }; // Will convert to avi
        } else if (format === 'gif') {
            options = { mimeType: 'video/webm;codecs=vp8' }; // Will convert to gif
        }

        try {
            this.mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            // Fallback to default codec
            this.mediaRecorder = new MediaRecorder(stream);
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.saveRecording();
        };

        this.mediaRecorder.start();
        console.log(`Started recording in ${format} format`);
    }

    // Stop recording
    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;

        this.mediaRecorder.stop();
        this.isRecording = false;
        console.log('Recording stopped');
    }

    // Save recorded video
    async saveRecording() {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });

        // Show converting message
        console.log(`Converting to ${this.recordingFormat.toUpperCase()}...`);

        try {
            // Create FormData to send to server
            const formData = new FormData();
            formData.append('video', blob, 'recording.webm');
            formData.append('format', this.recordingFormat);

            // Send to server for conversion
            const response = await fetch('http://localhost:5000/api/convert-video', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Conversion failed');
            }

            // Get the converted file
            const convertedBlob = await response.blob();
            const url = URL.createObjectURL(convertedBlob);

            // Extract filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `cnc-recording.${this.recordingFormat}`;
            if (contentDisposition) {
                const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
                if (matches != null && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }

            // Download the file
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            console.log(`Successfully converted and downloaded as ${this.recordingFormat.toUpperCase()}`);

        } catch (error) {
            console.error('Conversion error:', error);
            alert(`Fout bij conversie: ${error.message}\n\nZorg ervoor dat FFmpeg is geïnstalleerd op de server.`);
        }

        this.recordedChunks = [];
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

    /**
     * parseGCode - Hoofdfunctie voor het parsen van G-code naar animatiestappen
     * 
     * Deze functie verwerkt de volledige G-code en converteert het naar een reeks animatiestappen.
     * Elk commando wordt geanalyseerd en de staat van de machine wordt bijgehouden.
     * 
     * Belangrijke verantwoordelijkheden:
     * 1. Machine variabelen vervangen (zoals $XOFFSET)
     * 2. Posities bijwerken tijdens parsing (ONE-TIME execution)
     * 3. TRANS delta's toepassen op currentPosition tijdens parsing
     * 4. Animatiestappen aanmaken met from/to posities in lokale coördinaten
     * 5. Tool changes, rotaties en offset wijzigingen verwerken
     * 
     * KRITIEK: currentPosition wordt ALLEEN HIER aangepast (parse-time)
     * De renderUpToStep functie mag currentPosition NIET aanpassen (render-time)
     * 
     * @param {string} gcode - De volledige G-code als string
     */
    parseGCode(gcode) {
        console.log('[parseGCode] Starting parse, G-code length:', gcode.length);

        // Reset alle state en verwijder vorige visualisatie
        this.clear();
        this.animationSteps = [];

        // Vervang machine variabelen zoals $XOFFSET door hun actuele waarden
        console.log('[parseGCode] Calling resolveMachineVariables...');
        gcode = this.resolveMachineVariables(gcode);
        console.log('[parseGCode] After variable resolution, G-code length:', gcode.length);

        const lines = gcode.split('\n');
        let isAbsolute = true; // G90/G91
        let currentFeed = 0;
        let lineNumber = 0;
        let currentGCode = null; // Modal G-code state (G0, G1, G2, G3)
        
        // IF/ENDIF control flow state
        let ifStack = []; // Stack to handle nested IF blocks: [{condition: bool, lineNumber: int}]
        let skipMode = false; // True when we're skipping code inside a false IF block

        lines.forEach(line => {
            lineNumber++;
            const originalLine = line;

            try {
                // Remove comments and whitespace
                // Strip anything after ';' or '('
                // Remove leading line numbers like: N1234<space>
                line = line.split(';')[0].split('(')[0].replace(/^\s*N\d+\s+/i, '').trim().toUpperCase();
                if (!line) return;

                // Check for IF statement
                if (line.startsWith('IF')) {
                    console.log(`[parseGCode] Found IF at line ${lineNumber}: ${line}`);
                    const condition = this.evaluateCondition(line, lineNumber);
                    ifStack.push({ condition, lineNumber });
                    
                    // Update skip mode: skip if any parent IF is false OR this IF is false
                    skipMode = !condition || ifStack.slice(0, -1).some(block => !block.condition);
                    
                    console.log(`[parseGCode] IF condition=${condition}, skipMode=${skipMode}, stack depth=${ifStack.length}`);
                    return;
                }
                
                // Check for ENDIF
                if (line.startsWith('ENDIF')) {
                    if (ifStack.length === 0) {
                        console.warn(`[parseGCode] ENDIF without matching IF at line ${lineNumber}`);
                        return;
                    }
                    
                    const ifBlock = ifStack.pop();
                    console.log(`[parseGCode] ENDIF at line ${lineNumber} (matched IF from line ${ifBlock.lineNumber})`);
                    
                    // Update skip mode: skip only if any remaining parent IF is false
                    skipMode = ifStack.some(block => !block.condition);
                    console.log(`[parseGCode] After ENDIF: skipMode=${skipMode}, stack depth=${ifStack.length}`);
                    return;
                }
                
                // If we're in skip mode, don't process this line
                if (skipMode) {
                    console.log(`[parseGCode] Skipping line ${lineNumber} (inside false IF block)`);
                    return;
                }

                // Debug: log lines that contain Z= and are near the end
                if (line.includes('Z=') && lineNumber > lines.length - 10) {
                    console.log(`[parseGCode] Line ${lineNumber}/${lines.length}: "${line}"`);
                }

                // If this line tells the postprocessor to wait (STOPRE), ignore the STOPRE token
                // but continue parsing the rest of the line. If nothing remains after removing
                // STOPRE, move to the next line.
                if (/\bSTOPRE\b/i.test(line)) {
                    line = line.replace(/\bSTOPRE\b/ig, '').trim();
                    if (!line) return;
                }

                // Check for DEF variable definitions
                if (line.startsWith('DEF')) {
                    console.log(`Found DEF command: ${line}`);
                    const defData = this.parseDEF(line, lineNumber, originalLine);
                    if (defData) {
                        console.log('DEF parsed successfully:', defData);
                        this.animationSteps.push(defData);
                    }
                    return;
                }

                // Check for positioning mode
                if (line.includes('G90')) {
                    isAbsolute = true;
                } else if (line.includes('G91')) {
                    isAbsolute = false;
                }

                // Parse Siemens 840D AROT command (axis rotation)
                if (line.includes('AROT')) {
                    console.log(`Found AROT command: ${line}`);
                    console.log(`[AROT DEBUG] BEFORE - currentPosition: X=${this.currentPosition.x} Y=${this.currentPosition.y} Z=${this.currentPosition.z}`);
                    const rotationData = this.parseAROT(line, lineNumber, originalLine);
                    if (rotationData) {
                        console.log('AROT parsed successfully:', rotationData);
                        console.log(`[AROT DEBUG] rotationData.to: X=${rotationData.to.x} Y=${rotationData.to.y} Z=${rotationData.to.z}`);
                        this.animationSteps.push(rotationData);
                        this.currentRotation = rotationData.to;
                        console.log(`[AROT DEBUG] AFTER rotation update - currentPosition: X=${this.currentPosition.x} Y=${this.currentPosition.y} Z=${this.currentPosition.z}`);
                        this.updateRotationMatrix();
                        this.updateRotationHelper();
                        console.log(`[AROT DEBUG] AFTER updateRotationHelper - currentPosition: X=${this.currentPosition.x} Y=${this.currentPosition.y} Z=${this.currentPosition.z}`);
                    }
                    return; // Skip rest of line parsing - AROT X/Y/Z are rotation angles, not positions!
                }

                // Parse Siemens 840D TRANS command (origin offset/translation)
                // TRANS verschuift het nulpunt van het coördinatenstelsel
                if (line.includes('TRANS')) {
                    console.log(`Found TRANS command: ${line}`);
                    const transData = this.parseTRANS(line, lineNumber, originalLine);
                    if (transData) {
                        console.log('TRANS parsed successfully:', transData);
                        this.animationSteps.push(transData);

                        // KRITIEKE LOGICA: Update offset EN pas currentPosition aan
                        // Wanneer het nulpunt +X verschuift, moet de tool positie -X verschuiven
                        // om op dezelfde absolute locatie te blijven.
                        // 
                        // Voorbeeld: Tool staat op (100, 50) in wereld coördinaten
                        // TRANS X=2050 verschuift nulpunt naar rechts
                        // Tool moet nu (-1950, 50) worden in nieuwe lokale coördinaten
                        // zodat wereld positie hetzelfde blijft: -1950 + 2050 = 100
                        // 
                        // DIT GEBEURT SLECHTS ÉÉN KEER TIJDENS PARSING!
                        // renderUpToStep mag dit NIET herhalen (veroorzaakt cumulatieve fouten)
                        const deltaX = transData.to.x - transData.from.x;
                        const deltaY = transData.to.y - transData.from.y;
                        const deltaZ = transData.to.z - transData.from.z;

                        this.currentOffset = transData.to;
                        this.currentPosition.x -= deltaX;  // Lokale X vermindert met delta
                        this.currentPosition.y -= deltaY;  // Lokale Y vermindert met delta
                        this.currentPosition.z -= deltaZ;  // Lokale Z vermindert met delta

                        console.log(`[parseGCode] TRANS applied: delta=(${deltaX}, ${deltaY}, ${deltaZ}) → currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
                    }
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
                }

                // Parse tool change command (T followed by number)
                // Must be word boundary before T and followed by digit(s) and then space or end of line
                const toolMatch = line.match(/\bT(\d+)(?:\s|$)/);
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

                    // KRITIEK: Update NIET this.currentPosition.z naar safeZ!
                    // 
                    // Waarom niet?
                    // - currentPosition moet de werkelijke toolpath positie blijven
                    // - Als we hier Z=450 zetten, beïnvloedt dat de volgende beweging
                    // - Volgende G1 zou dan starten vanaf Z=450 ipv werkelijke Z positie
                    // - Dit veroorzaakt verticale lijnen in de toolpath naar Z=450
                    // 
                    // Oplossing:
                    // - Tool wissel stap krijgt WEL from.z=oldZ en to.z=safeZ voor visualisatie
                    // - Maar this.currentPosition.z blijft ONGEWIJZIGD op werkelijke Z
                    // - Tool wordt alleen visueel naar safeZ bewogen tijdens rendering
                    // - Toolpath lijnen gebruiken correcte posities zonder Z=450 contaminatie

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

                        // D0 means no tool compensation - use default indicator
                        if (dNumber === 0) {
                            this.currentTool = null;
                            console.log('Offset D0 - no tool compensation, showing default indicator');

                            this.updateRotationHelper(); // This will show default tool indicator

                            this.animationSteps.push({
                                lineNumber,
                                originalLine: originalLine.trim(),
                                command: 'OFFSET_CHANGE',
                                pl: this.currentPL,
                                d: 0,
                                tool: null,
                                description: `D0: Geen compensatie`
                            });
                            // Don't return - continue to process other commands on this line
                        }

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
                        // Don't return - continue to process other commands on this line
                    } else {
                        // D change WITH movement - update D but let movement be processed
                        this.currentD = dNumber;

                        // D0 means no tool compensation
                        if (dNumber === 0) {
                            this.currentTool = null;
                            console.log('Offset D0 with movement - no tool compensation');
                            this.updateRotationHelper();
                        } else if (this.currentPL) {
                            this.currentTool = getToolByPLD(this.currentPL, dNumber);
                            console.log(`Offset changed to D${dNumber} with movement`, this.currentTool);
                            this.updateRotationHelper();
                        }
                        // Don't return - continue to process movement
                    }
                }

                // Check for explicit G-code commands to update modal state
                const hasG04 = line.match(/\bG4\b/);
                // Use word boundaries to prevent false matches (e.g., G0 vs G01)
                // G-codes are MODAL - they stay active until another movement G-code is specified
                const hasG00 = line.match(/\bG0\b/) || line.match(/\bG00\b/);
                const hasG01 = line.match(/\bG1\b/) || line.match(/\bG01\b/);
                const hasG02 = line.match(/\bG2\b/) || line.match(/\bG02\b/);
                const hasG03 = line.match(/\bG3\b/) || line.match(/\bG03\b/);

                // Update modal G-code if a new one is specified
                // These remain active until changed by another G0/G1/G2/G3 command
                if (hasG04) currentGCode = 'G4';
                else if (hasG00) currentGCode = 'G0';
                else if (hasG01) currentGCode = 'G1';
                else if (hasG02) currentGCode = 'G2';
                else if (hasG03) currentGCode = 'G3';

                // Check for feedrate command (F)
                const fMatch = line.match(/F([-+]?\d*\.?\d+)/);
                if (fMatch) {
                    const fVal = parseFloat(fMatch[1]);
                    if (currentGCode === 'G4' || hasG04) {
                        // For G4 (dwell), F is a time indicator in seconds (e.g. F=0.1 -> 0.1s)
                        const dwellSeconds = fVal;
                        console.log(`[parseGCode] G4 dwell detected: ${dwellSeconds} seconds`);
                        this.animationSteps.push({
                            lineNumber,
                            originalLine: originalLine.trim(),
                            command: 'G4',
                            from: { ...this.currentPosition },
                            to: { ...this.currentPosition },
                            isDwell: true,
                            dwellSeconds,
                            description: `Dwell ${dwellSeconds}s`
                        });
                    } else {
                        this.currentFeedrate = fVal;
                        console.log(`[parseGCode] Feedrate set to: ${this.currentFeedrate} mm/min`);
                    }
                }

                // Check for tool radius compensation commands and track transitions
                const previousCompensation = this.radiusCompensation;
                const hasG40 = line.match(/\bG40\b/);
                const hasG41 = line.match(/\bG41\b/);
                const hasG42 = line.match(/\bG42\b/);

                if (hasG40) this.radiusCompensation = 'G40'; // Cancel compensation
                if (hasG41) this.radiusCompensation = 'G41'; // Left compensation
                if (hasG42) this.radiusCompensation = 'G42'; // Right compensation

                // Detecteer of er een compensatie transitie is
                const compensationChanged = previousCompensation !== this.radiusCompensation;

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

                    // Handle radius compensation transitions
                    // G40 → G41/G42: Opbouwen (center → offset)
                    // G41/G42 → G40: Afbouwen (offset → center)
                    // G41 ↔ G42: Direct overgang (offset links → offset rechts)
                    if (compensationChanged && currentGCode === 'G1') {
                            const isActivating = previousCompensation === 'G40' && (this.radiusCompensation === 'G41' || this.radiusCompensation === 'G42');
                            const isDeactivating = (previousCompensation === 'G41' || previousCompensation === 'G42') && this.radiusCompensation === 'G40';
                            const isDirectSwitch = (previousCompensation === 'G41' && this.radiusCompensation === 'G42') || (previousCompensation === 'G42' && this.radiusCompensation === 'G41');
    
                        if (isActivating || isDeactivating || isDirectSwitch) {
                            console.log(`[parseGCode] Radius compensation transition: ${previousCompensation} → ${this.radiusCompensation}`);
    
                            // Mark this step as a compensation transition
                            // This will be handled specially during rendering/animation
                            const stepInfo = {
                                lineNumber,
                                originalLine: originalLine.trim(),
                                command: currentGCode,
                                from: { ...this.currentPosition },
                                to: { ...newPos },
                                isRapid: false,
                                radiusCompensation: this.radiusCompensation,
                                previousCompensation: previousCompensation,
                                isCompensationTransition: true,
                                isActivating: isActivating,
                                isDeactivating: isDeactivating,
                                isDirectSwitch: isDirectSwitch
                            };
    
                            // Push the special compensation transition step and skip normal processing for this line
                            this.animationSteps.push(stepInfo);
                            return;
                        }
                    }

                    const stepInfo = {
                        lineNumber,
                        originalLine: originalLine.trim(),
                        command: currentGCode,
                        from: { ...this.currentPosition },
                        to: { ...newPos },
                        isRapid: currentGCode === 'G0',
                        radiusCompensation: this.radiusCompensation,  // Save G40/G41/G42 state
                        feedrate: this.currentFeedrate  // Save current feedrate
                    };

                    console.log(`[parseGCode] Line ${lineNumber}: ${currentGCode} from=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)}) to=(${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)}, ${newPos.z.toFixed(2)})`);

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

    parseDEF(line, lineNumber, originalLine) {
        // Parse DEF statements where a type can be declared once and applies
        // to subsequent comma-separated variables until a new type appears.
        // Examples:
        //   DEF REAL X = 2515, Y = 100
        //   DEF STRING[10] NAME = "ABC", CODE = '1'
        const payload = line.replace(/^DEF\s+/i, '').trim();
        if (!payload) return null;

        const parts = payload.split(',').map(p => p.trim()).filter(Boolean);
        const parsed = [];

        let currentType = null;
        let currentLength = null;

        parts.forEach(part => {
            // Try to detect a new type at the start of the part
            const typePrefix = part.match(/^([A-Z]+(?:\[(\d+)\])?)\s+(.*)$/i);
            let namePart = part;
            if (typePrefix) {
                // New type specified; update currentType/currentLength
                const fullType = typePrefix[1].toUpperCase();
                const len = typePrefix[2] ? parseInt(typePrefix[2], 10) : null;
                const tMatch = fullType.match(/^(STRING)(?:\[\d+\])?$/i);
                currentType = tMatch ? 'STRING' : fullType.replace(/\[\d+\]/, '').toUpperCase();
                currentLength = len;
                namePart = typePrefix[3].trim();
            }

            // Now parse name and optional assignment from namePart
            const nm = namePart.match(/^([A-Z_][A-Z0-9_]*)\s*(?:=\s*(.+))?$/i);
            if (!nm) return; // skip invalid token

            const name = nm[1].toUpperCase();
            let rawValue = nm[2] ? nm[2].trim() : undefined;

            // If no currentType defined yet, skip this definition
            if (!currentType) return;

            // Normalize value: remove surrounding quotes if present
            let value = rawValue;
            if (typeof value === 'string') {
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.trim();
            }

            // Coerce numeric types
            if (value !== undefined && (currentType === 'REAL' || currentType === 'INT')) {
                const num = Number(value);
                if (!Number.isNaN(num)) {
                    value = (currentType === 'INT') ? Math.trunc(num) : num;
                }
            }

            // Enforce string length if provided
            if (value !== undefined && currentType === 'STRING' && currentLength && typeof value === 'string') {
                if (value.length > currentLength) value = value.substring(0, currentLength);
            }

            // Store definition and value (if present) in runtime maps
            this.localVariableDefs[name] = { type: currentType, length: currentLength };
            if (value !== undefined) {
                this.localVariables[`$${name}`] = String(value);
                this.localVariables[name] = String(value);
            }

            parsed.push({ name, type: currentType, length: currentLength, value });
        });

        return {
            lineNumber,
            originalLine: originalLine.trim(),
            command: 'DEF',
            definitions: parsed,
            description: `DEF: ${parsed.map(d => `${d.type} ${d.name}${d.length ? `[${d.length}]` : ''}${d.value !== undefined ? `=${d.value}` : ''}`).join(', ')}`
        };
    }

    evaluateCondition(line, lineNumber) {
        // Parse and evaluate IF condition
        // Format: IF <expression>
        // Supported operators: ==, !=, <, >, <=, >=, AND, OR
        
        const conditionPart = line.substring(2).trim(); // Remove 'IF' prefix
        if (!conditionPart) {
            console.warn(`[evaluateCondition] Empty IF condition at line ${lineNumber}`);
            return false;
        }
        
        console.log(`[evaluateCondition] Evaluating: ${conditionPart}`);
        
        try {
            // Replace variable names with their values
            let expression = conditionPart;
            
            // Merge stored variables and local variables for substitution
            const allVariables = { ...JSON.parse(localStorage.getItem('machineVariables') || '{}'), ...this.localVariables };
            
            // Sort variables by length (longest first) to avoid partial replacements
            const variableNames = Object.keys(allVariables).sort((a, b) => b.length - a.length);
            
            for (const varName of variableNames) {
                const value = allVariables[varName];
                // Use word boundaries to avoid partial replacements
                const regex = new RegExp(`\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
                expression = expression.replace(regex, value);
            }
            
            console.log(`[evaluateCondition] After variable substitution: ${expression}`);
            
            // Replace logical operators with JavaScript equivalents
            expression = expression
                .replace(/\bAND\b/gi, '&&')
                .replace(/\bOR\b/gi, '||')
                .replace(/\bNOT\b/gi, '!')
                .replace(/=/g, '==')  // Single = becomes ==
                .replace(/====/g, '==')  // Fix double replacement
                .replace(/<>/g, '!=')    // <> becomes !=
                .replace(/><=/g, '!=');  // Alternative not-equal
            
            // Validate expression contains only safe characters
            if (!/^[\d\s+\-*/.()<>=!&|]+$/.test(expression)) {
                console.warn(`[evaluateCondition] Invalid characters in expression: ${expression}`);
                return false;
            }
            
            // Evaluate the expression
            const result = Function(`"use strict"; return (${expression})`)();
            const boolResult = Boolean(result);
            
            console.log(`[evaluateCondition] Expression: ${expression} => ${result} (${boolResult})`);
            return boolResult;
            
        } catch (error) {
            console.error(`[evaluateCondition] Error evaluating condition at line ${lineNumber}: ${error.message}`);
            console.error(`[evaluateCondition] Original: ${conditionPart}`);
            return false; // Default to false on error
        }
    }

    parseTRANS(line, lineNumber, originalLine) {
        // Siemens 840D TRANS command: translates/shifts the origin (nulpunt)
        // Format: TRANS X=value Y=value Z=value
        // Can include expressions like X=2515+XOFFSET

        // 'from' moet de huidige software-offset zijn (huidig nulpunt in software)
        // TRANS is een nulpuntverplaatsing in software; de fysieke machine verplaatst zich niet.
        const from = { ...this.currentOffset };
        const to = { ...this.currentOffset };

        // Parse X, Y, Z values (extract numeric part before + or end of value)
        const xMatch = line.match(/X\s*=\s*([+-]?\d+\.?\d*)/);
        const yMatch = line.match(/Y\s*=\s*([+-]?\d+\.?\d*)/);
        const zMatch = line.match(/Z\s*=\s*([+-]?\d+\.?\d*)/);

        const hasX = !!xMatch;
        const hasY = !!yMatch;
        const hasZ = !!zMatch;

        if (hasX) to.x = parseFloat(xMatch[1]);
        if (hasY) to.y = parseFloat(yMatch[1]);
        if (hasZ) to.z = parseFloat(zMatch[1]);

        // If NO coordinates were present at all, reset to workpiece origin (0,0,0)
        if (!hasX && !hasY && !hasZ) {
            to.x = 0;
            to.y = 0;
            to.z = 0;
        }

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

    /**
     * updateRotationMatrix - Update de transformatie matrix voor AROT rotaties
     * 
     * Siemens 840D AROT rotaties worden opgeslagen in Euler hoeken (graden).
     * Deze functie converteert naar Three.js rotatie matrix.
     * 
     * Coördinaten mapping:
     * - CNC X rotatie → Three.js X rotatie
     * - CNC Y rotatie → Three.js -Z rotatie (negatief!)
     * - CNC Z rotatie → Three.js Y rotatie
     * 
     * Rotatie volgorde: ZYX (eerst Z, dan Y, dan X)
     */
    updateRotationMatrix() {
        // Update de transformatie matrix gebaseerd op huidige rotatie
        // Deze matrix transformeert punten van het lokale tool coördinatenstelsel
        // naar het wereld coördinatenstelsel

        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(this.currentRotation.x),   // CNC X → Three.js X
            THREE.MathUtils.degToRad(this.currentRotation.z),   // CNC Z → Three.js Y
            THREE.MathUtils.degToRad(-this.currentRotation.y),  // CNC Y → Three.js -Z (negatief!)
            'ZYX'  // Rotatie volgorde: eerst Z-as, dan Y-as, dan X-as
        );

        this.rotationMatrix.makeRotationFromEuler(euler);

        console.log('Updated rotation matrix for:', this.currentRotation);
    }

    /**
     * resolveMachineVariables - Vervang machine variabelen in G-code
     * 
     * Leest variabelen uit localStorage (bijv. $XOFFSET, $YOFFSET) en
     * vervangt alle voorkomens in de G-code met hun numerieke waarden.
     * 
     * Voorbeeld:
     *   Machine variabelen: { "$XOFFSET": "2515", "$YOFFSET": "665" }
     *   G-code voor: "TRANS X=$XOFFSET Y=$YOFFSET"
     *   G-code na: "TRANS X=2515 Y=665"
     * 
     * Gebruikt regex met geescapte special characters voor veilige vervanging.
     * 
     * @param {string} gcode - Originele G-code met variabelen
     * @returns {string} G-code met vervangen variabelen
     */
    resolveMachineVariables(gcode) {
        // Haal machine variabelen op uit localStorage
        const saved = localStorage.getItem('machineVariables');
        console.log('[resolveMachineVariables] localStorage raw:', saved);

        // If nothing stored, continue — DEF-created local variables may still exist
        const variables = saved ? JSON.parse(saved) : {};
        if (!saved) {
            console.log('No stored variables defined, using runtime local variables only');
        } else {
            console.log('Stored variables loaded:', variables);
            console.log('Number of stored variables:', Object.keys(variables).length);
        }

        // Replace all variables in the G-code
        let resolvedCode = gcode;
        let replacementCount = 0;

        // Merge runtime local variables from DEF statements so they can override or supplement localStorage
        const runtimeVars = { ...(variables || {}), ...(this.localVariables || {}) };

        // Debug: check if G-code contains the variable name
        Object.entries(runtimeVars).forEach(([name, value]) => {
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

        Object.entries(runtimeVars).forEach(([name, value]) => {
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
        if (this.currentPL && this.currentD !== undefined) {
            const allTools = getAllToolsByPL(this.currentPL);

            // Check if the specific PL+D combination exists
            const specificTool = allTools.find(t => t.d === this.currentD);

            if (allTools.length > 0 && specificTool) {
                // Sort by length to determine offsets
                const sortedTools = [...allTools].sort((a, b) => a.length - b.length);

                // The active tool (currentD) is at y=0 (cutting point)
                // Other tools extend below based on length difference
                allTools.forEach(tool => {
                    try {
                        const isActive = tool.d === this.currentD;
                        console.log(`[updateRotationHelper] Creating mesh for PL${tool.pl} D${tool.d}: rotation="${tool.rotation}", isActive=${isActive}`);
                        const toolMesh = createToolGeometry(tool, 'G40', isActive);

                        // If this is not the active D, offset it downward
                        if (!isActive) {
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
                // No tools found OR specific D not found for this PL - use default
                console.log(`Tool PL${this.currentPL} D${this.currentD} not found in library - using default indicator`);
                this.addDefaultToolIndicator();
            }
        } else if (this.currentTool) {
            // Fallback: only show current tool
            try {
                console.log(`[updateRotationHelper] Fallback - Creating mesh for currentTool: PL${this.currentTool.pl} D${this.currentTool.d}, rotation="${this.currentTool.rotation}"`);
                const toolMesh = createToolGeometry(this.currentTool, 'G40', true);
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

        // Calculate tool position with radius compensation
        console.log(`[updateRotationHelper] Starting - currentPosition: X=${this.currentPosition.x} Y=${this.currentPosition.y} Z=${this.currentPosition.z}`);
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

    /**
     * parseArc - Parse boog beweging (G2/G3) parameters
     * 
     * Ondersteunt twee formaten:
     * 1. IJK formaat: G2 X100 Y50 I20 J30 (I/J relatief t.o.v. startpunt)
     * 2. R formaat: G2 X100 Y50 R25 (radius van de boog)
     * 
     * G2 = Met de klok mee (Clockwise)
     * G3 = Tegen de klok in (Counter-Clockwise)
     * 
     * Boog definitie:
     * - Start: Huidige positie (this.currentPosition)
     * - Eind: Nieuwe X/Y/Z waarden uit G-code
     * - Center: Berekend via I/J offset of R radius
     * 
     * @param {string} line - G-code regel met boog commando
     * @param {boolean} isAbsolute - G90/G91 absolute/incrementele modus
     * @param {boolean} isClockwise - true=G2, false=G3
     * @returns {Object|null} Arc data {start, end, center} of null bij fout
     */
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

    /**
     * applyRadiusCompensation - Pas tool radius compensatie toe (G41/G42)
     * 
     * LET OP: Deze functie wordt NIET gebruikt voor animatie!
     * Tool compensatie tijdens animatie gebeurt in:
     * - updateToolPosition() voor smooth animatie
     * - renderUpToStep() voor statische rendering
     * 
     * G40 = Geen compensatie (tool volgt geprogrammeerd pad)
     * G41 = Links compensatie (tool links van pad)
     * G42 = Rechts compensatie (tool rechts van pad)
     * 
     * Berekent loodrechte offset:
     * - Richting vector normaliseren (lengte = 1)
     * - Draai 90° tegen klok (G41) of met klok (G42)
     * - Vermenigvuldig met tool radius
     * 
     * @param {Object} from - Start positie {x, y, z}
     * @param {Object} to - Eind positie {x, y, z}
     * @returns {Object} {from, to} met geöffset posities
     */
    applyRadiusCompensation(from, to) {
        // Pas G41/G42 tool radius compensatie toe
        // G40 = geen compensatie, G41 = links van pad, G42 = rechts van pad

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

    /**
     * addRapidMove - Voeg snelle verplaatsing toe (G0)
     * 
     * G0 bewegingen worden getekend als gestippelde lijnen.
     * Dit zijn snelle positioneringen zonder snijden.
     * 
     * GEEN tool radius compensatie toegepast - toont geprogrammeerd pad.
     * 
     * @param {Object} from - Start positie {x, y, z} in lokale coördinaten
     * @param {Object} to - Eind positie {x, y, z} in lokale coördinaten
     */
    addRapidMove(from, to) {
        // Converteer CNC coördinaten naar Three.js en pas transformatie toe
        const fromVec = this.transformPoint(from.x, from.y, from.z);
        const toVec = this.transformPoint(to.x, to.y, to.z);

        this.rapidPoints.push(fromVec, toVec);
    }

    /**
     * addCuttingMove - Voeg snij beweging toe (G1)
     * 
     * G1 bewegingen worden getekend als doorgetrokken lijnen.
     * Dit zijn snijbewegingen met feedrate.
     * 
     * LET OP: GEEN radius compensatie hier - toolpath toont geprogrammeerd pad!
     * Tool compensatie wordt alleen toegepast voor tool visualisatie, niet voor lijnen.
     * 
     * @param {Object} from - Start positie {x, y, z} in lokale coördinaten
     * @param {Object} to - Eind positie {x, y, z} in lokale coördinaten
     */
    addCuttingMove(from, to) {
        // Converteer CNC coördinaten naar Three.js en pas transformatie toe
        // LET OP: GEEN radius compensatie - toolpath toont het geprogrammeerde pad
        const fromVec = this.transformPoint(from.x, from.y, from.z);
        const toVec = this.transformPoint(to.x, to.y, to.z);

        this.toolpathPoints.push(fromVec, toVec);
    }

    /**
     * transformPoint - Transformeer CNC coördinaten naar wereld coördinaten
     * 
     * Deze functie voert TWEE transformaties uit:
     * 1. ROTATIE (AROT): Draait lokale tool coördinaten naar wereld orientatie
     * 2. TRANSLATIE (TRANS): Verschuift nulpunt via offset
     * 
     * KRITIEK: Deze functie leest currentOffset maar wijzigt het NIET!
     * Het is een pure transformatie functie zonder side-effects.
     * 
     * Coördinaten conversie CNC → Three.js:
     * - CNC X (lengte) → Three.js X
     * - CNC Y (breedte) → Three.js -Z (negatief!)
     * - CNC Z (diepte) → Three.js Y
     * 
     * @param {number} x - CNC X coördinaat (lokaal)
     * @param {number} y - CNC Y coördinaat (lokaal)
     * @param {number} z - CNC Z coördinaat (lokaal)
     * @returns {THREE.Vector3} Getransformeerde wereld positie
     */
    transformPoint(x, y, z) {
        // Maak een vector in het lokale CNC coördinatenstelsel
        // Wanneer de tool geroteerd is (AROT), zijn X/Y/Z bewegingen in het tool frame
        // We moeten ze transformeren naar wereld coördinaten

        // Start met beweging in lokale tool coördinaten
        // CNC: X=lengte, Y=breedte, Z=diepte (positief=terugtrekken, negatief=duiken)
        const localVector = new THREE.Vector3(x, z, -y);

        // Pas rotatie transformatie toe om van tool ruimte naar wereld ruimte te gaan
        localVector.applyMatrix4(this.rotationMatrix);

        // Pas offset toe (TRANS commando verschuift het nulpunt)
        // LET OP: currentOffset wordt ALLEEN GELEZEN, NIET GEWIJZIGD!
        localVector.x += this.currentOffset.x;
        localVector.y += this.currentOffset.z; // CNC Z → Three.js Y
        localVector.z += -this.currentOffset.y; // CNC Y → Three.js -Z

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
            if (this.doorOutline.userData.doorParts) {
                this.doorOutline.userData.doorParts.forEach(part => {
                    this.scene.remove(part);
                    part.geometry.dispose();
                    part.material.dispose();
                });
            }
            // Remove fold/rabbet meshes if they exist
            if (this.doorOutline.userData.folds) {
                this.doorOutline.userData.folds.forEach(fold => {
                    this.scene.remove(fold);
                    fold.geometry.dispose();
                    fold.material.dispose();
                });
            }
            this.doorOutline.geometry.dispose();
            this.doorOutline.material.dispose();
        }

        // Create door outline box
        const length = params.length || 2000;
        const width = params.width || 800;
        const thickness = params.thickness || 40;
        
        // Fold/opdek parameters
        const foldAbove = params.fold_above || 0;
        const foldLeft = params.fold_left || 0;
        const foldRight = params.fold_right || 0;
        
        // Opdek hoogte: 25.5mm if any fold exists, otherwise 0
        const foldHeight = (foldAbove > 0 || foldLeft > 0 || foldRight > 0) ? 25.5 : 0;

        console.log(`Creating door box: ${length} x ${width} x ${thickness}`);
        console.log(`Fold parameters: above=${foldAbove}, left=${foldLeft}, right=${foldRight}, height=${foldHeight}`);

        // Materials
        const surfaceMaterial = new THREE.MeshBasicMaterial({
            color: 0x8b7355,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        
        const foldMaterial = new THREE.MeshBasicMaterial({
            color: 0x6b5345,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x4444ff,
            linewidth: 3
        });
        
        const foldEdgeMaterial = new THREE.LineBasicMaterial({
            color: 0x8b4513,
            linewidth: 2
        });

        const doorParts = [];
        const foldMeshes = [];
        const allEdges = [];

        // Create door geometry in sections to accommodate folds
        if (foldHeight > 0) {
            // Door has folds - create sections
            
            // Bottom section (below folds): from Y=foldHeight to Y=thickness
            const bottomHeight = thickness - foldHeight;
            const bottomGeometry = new THREE.BoxGeometry(length, bottomHeight, width);
            const bottomMesh = new THREE.Mesh(bottomGeometry, surfaceMaterial);
            bottomMesh.position.set(length / 2, foldHeight + bottomHeight / 2, -width / 2);
            this.scene.add(bottomMesh);
            doorParts.push(bottomMesh);
            
            const bottomEdges = new THREE.EdgesGeometry(bottomGeometry);
            const bottomEdgeMesh = new THREE.LineSegments(bottomEdges, edgeMaterial);
            bottomEdgeMesh.position.copy(bottomMesh.position);
            this.scene.add(bottomEdgeMesh);
            allEdges.push(bottomEdgeMesh);

            // Top sections (in fold area Y=0 to Y=foldHeight)
            // Create separate pieces for areas not covered by folds
            
            // Calculate which areas need top sections
            const needTopLeft = foldLeft === 0;
            const needTopRight = foldRight === 0;
            const needTopAbove = foldAbove === 0;
            
            // Top-left corner section (if no left fold)
            if (needTopLeft && foldLeft === 0) {
                const topLeftZ = foldLeft > 0 ? foldLeft : (foldRight > 0 || foldAbove > 0 ? 
                    (foldRight > 0 ? width - foldRight : width) : width);
                if (topLeftZ > 0) {
                    const topLeftGeometry = new THREE.BoxGeometry(
                        foldAbove > 0 ? length - foldAbove : length,
                        foldHeight,
                        topLeftZ
                    );
                    const topLeftMesh = new THREE.Mesh(topLeftGeometry, surfaceMaterial);
                    const topLeftX = foldAbove > 0 ? (length - foldAbove) / 2 : length / 2;
                    topLeftMesh.position.set(topLeftX, foldHeight / 2, -topLeftZ / 2);
                    this.scene.add(topLeftMesh);
                    doorParts.push(topLeftMesh);
                    
                    const topLeftEdges = new THREE.EdgesGeometry(topLeftGeometry);
                    const topLeftEdgeMesh = new THREE.LineSegments(topLeftEdges, edgeMaterial);
                    topLeftEdgeMesh.position.copy(topLeftMesh.position);
                    this.scene.add(topLeftEdgeMesh);
                    allEdges.push(topLeftEdgeMesh);
                }
            }
            
            // Middle section (between left and right folds, if both exist)
            if (foldLeft > 0 && foldRight > 0) {
                const middleZ = width - foldLeft - foldRight;
                if (middleZ > 0) {
                    const middleGeometry = new THREE.BoxGeometry(
                        foldAbove > 0 ? length - foldAbove : length,
                        foldHeight,
                        middleZ
                    );
                    const middleMesh = new THREE.Mesh(middleGeometry, surfaceMaterial);
                    const middleX = foldAbove > 0 ? (length - foldAbove) / 2 : length / 2;
                    middleMesh.position.set(middleX, foldHeight / 2, -foldLeft - middleZ / 2);
                    this.scene.add(middleMesh);
                    doorParts.push(middleMesh);
                    
                    const middleEdges = new THREE.EdgesGeometry(middleGeometry);
                    const middleEdgeMesh = new THREE.LineSegments(middleEdges, edgeMaterial);
                    middleEdgeMesh.position.copy(middleMesh.position);
                    this.scene.add(middleEdgeMesh);
                    allEdges.push(middleEdgeMesh);
                }
            }
            
            // Top-right corner section (if no right fold)
            if (needTopRight && foldRight === 0 && foldLeft > 0) {
                const topRightZ = width - foldLeft;
                if (topRightZ > 0) {
                    const topRightGeometry = new THREE.BoxGeometry(
                        foldAbove > 0 ? length - foldAbove : length,
                        foldHeight,
                        topRightZ
                    );
                    const topRightMesh = new THREE.Mesh(topRightGeometry, surfaceMaterial);
                    const topRightX = foldAbove > 0 ? (length - foldAbove) / 2 : length / 2;
                    topRightMesh.position.set(topRightX, foldHeight / 2, -foldLeft - topRightZ / 2);
                    this.scene.add(topRightMesh);
                    doorParts.push(topRightMesh);
                    
                    const topRightEdges = new THREE.EdgesGeometry(topRightGeometry);
                    const topRightEdgeMesh = new THREE.LineSegments(topRightEdges, edgeMaterial);
                    topRightEdgeMesh.position.copy(topRightMesh.position);
                    this.scene.add(topRightEdgeMesh);
                    allEdges.push(topRightEdgeMesh);
                }
            }

            // Fold areas are cut out from the door - no need to visualize them
            // Only log what was cut out
            if (foldAbove > 0) {
                console.log(`Cut ABOVE fold: ${foldAbove}mm wide x ${foldHeight}mm high at Y=0 to Y=${foldHeight}`);
            }
            if (foldLeft > 0) {
                console.log(`Cut LEFT fold: ${foldLeft}mm wide x ${foldHeight}mm high at Y=0 to Y=${foldHeight}`);
            }
            if (foldRight > 0) {
                console.log(`Cut RIGHT fold: ${foldRight}mm wide x ${foldHeight}mm high at Y=0 to Y=${foldHeight}`);
            }
            
        } else {
            // No folds - create simple door box
            const geometry = new THREE.BoxGeometry(length, thickness, width);
            const doorMesh = new THREE.Mesh(geometry, surfaceMaterial);
            doorMesh.position.set(length / 2, thickness / 2, -width / 2);
            this.scene.add(doorMesh);
            doorParts.push(doorMesh);
            
            const edges = new THREE.EdgesGeometry(geometry);
            const edgeMesh = new THREE.LineSegments(edges, edgeMaterial);
            edgeMesh.position.copy(doorMesh.position);
            this.scene.add(edgeMesh);
            allEdges.push(edgeMesh);
        }

        // Store the first edge mesh as the main doorOutline for compatibility
        this.doorOutline = allEdges[0] || new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
            edgeMaterial
        );
        
        // Store all parts for cleanup
        this.doorOutline.userData.doorParts = doorParts;
        this.doorOutline.userData.folds = foldMeshes;
        this.doorOutline.userData.allEdges = allEdges;

        console.log('Door with folds created');
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

        // Update UI with current step info
        this.updateAnimationUI(this.currentStepIndex, this.animationSteps.length, step);

        // Calculate delay based on feedrate if available and realistic speed is enabled
        let delay = this.animationSpeed;

        if (this.useRealisticSpeed && step.from && step.to) {
            // Calculate distance traveled
            const dx = step.to.x - step.from.x;
            const dy = step.to.y - step.from.y;
            const dz = step.to.z - step.from.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Determine effective feedrate
            let effectiveFeedrate;
            if (step.isRapid) {
                // G0 rapid move - use maximum rapid feedrate
                effectiveFeedrate = this.maxRapidFeedrate;
            } else if (step.feedrate && step.feedrate > 0) {
                // G1/G2/G3 with programmed feedrate
                effectiveFeedrate = step.feedrate;
            } else {
                // No feedrate available, use default speed
                effectiveFeedrate = null;
            }

            // Calculate time to traverse this distance (in milliseconds)
            if (effectiveFeedrate && effectiveFeedrate > 0) {
                // Feedrate is in mm/min, convert to mm/ms
                const feedrateMMperMS = effectiveFeedrate / 60000;
                delay = distance / feedrateMMperMS;
                console.log(`Realistic delay: ${delay.toFixed(0)}ms for ${distance.toFixed(2)}mm at ${effectiveFeedrate} mm/min ${step.isRapid ? '(G0 rapid)' : ''}`);
            }
        }

        // Render tot huidige stap en update tool positie (step-by-step, geen smoothing)
        this.renderUpToStep(this.currentStepIndex, false);
        this.currentStepIndex++;
        setTimeout(() => this.animateNextStep(), delay);
    }

    /**
     * animateSmoothMovement - Animeer tool beweging met 60fps interpolatie
     * 
     * Deze functie zorgt voor vloeiende tool beweging tussen from en to posities.
     * Gebruikt requestAnimationFrame voor smooth 60fps animatie.
     * 
     * Belangrijke kenmerken:
     * - Lineaire interpolatie van X, Y, Z coördinaten
     * - 60fps target met frame timing controle
     * - Respecteert feedrate-based duration via totalDuration parameter
     * - Stopt netjes wanneer isAnimating false wordt
     * - Roept updateToolPosition() aan (NIET renderUpToStep!)
     * 
     * @param {Object} step - De animatiestap met from/to posities
     * @param {number} totalDuration - Totale duur in milliseconden
     * @param {Function} callback - Functie om aan te roepen na voltooiing
     */
    animateSmoothMovement(step, totalDuration, callback) {
        const startTime = performance.now();
        const fps = 60; // Target 60 fps voor vloeiende animatie
        const frameInterval = 1000 / fps;  // ~16.67ms per frame
        let lastFrameTime = startTime;

        console.log(`[animateSmoothMovement] START: from=(${step.from.x.toFixed(2)}, ${step.from.y.toFixed(2)}, ${step.from.z.toFixed(2)}) to=(${step.to.x.toFixed(2)}, ${step.to.y.toFixed(2)}, ${step.to.z.toFixed(2)})`);

        const animate = (currentTime) => {
            if (!this.isAnimating) {
                // Animation stopped, restore to end position
                this.currentPosition = step.to;
                console.log(`[animateSmoothMovement] STOPPED: currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
                this.updateToolPosition();
                if (callback) callback();
                return;
            }

            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / totalDuration, 1.0);

            // Interpolate position
            this.currentPosition = {
                x: step.from.x + (step.to.x - step.from.x) * progress,
                y: step.from.y + (step.to.y - step.from.y) * progress,
                z: step.from.z + (step.to.z - step.from.z) * progress
            };

            // Update only tool position, don't redraw toolpath
            this.updateToolPosition();

            if (progress < 1.0 && this.isAnimating) {
                // Continue animation
                const now = performance.now();
                const timeSinceLastFrame = now - lastFrameTime;

                if (timeSinceLastFrame >= frameInterval) {
                    lastFrameTime = now - (timeSinceLastFrame % frameInterval);
                }

                requestAnimationFrame(animate);
            } else {
                // Animation complete, set final position
                this.currentPosition = step.to;
                console.log(`[animateSmoothMovement] COMPLETE: currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
                this.updateToolPosition();
                if (callback) callback();
            }
        };

        requestAnimationFrame(animate);
    }

    /**
     * Helper: Zoek de eerstvolgende stap met XY beweging (skip Z-only stappen)
     * @param {number} startIndex - Index om vanaf te zoeken
     * @returns {Object|null} - Eerste stap met XY beweging of null
     */
    findNextXYMovement(startIndex) {
        for (let i = startIndex; i < this.animationSteps.length; i++) {
            const step = this.animationSteps[i];
            if (step.from && step.to) {
                const dx = step.to.x - step.from.x;
                const dy = step.to.y - step.from.y;
                const xyMovement = Math.sqrt(dx * dx + dy * dy);

                if (xyMovement > 0.001) {
                    return step;
                }
            }
        }
        return null;
    }

    /**
     * Helper: Bereken tool offset voor compensatie transitie (opbouw/afbouw)
     * @param {Object} currentStep - Huidige stap
     * @param {Object} nextXYStep - Volgende stap met XY beweging
     * @param {number} toolRadius - Tool radius
     * @param {string} side - 'left' (G41) of 'right' (G42)
     * @param {number} progress - Progress 0.0-1.0 (0=start, 1=eind van transitie)
     * @returns {Object} - {x, y} offset
     */
    calculateCompensationTransitionOffset(currentStep, nextXYStep, toolRadius, side, progress) {
        if (!nextXYStep) return { x: 0, y: 0 };

        // Huidige transitie beweging richting
        const currDx = currentStep.to.x - currentStep.from.x;
        const currDy = currentStep.to.y - currentStep.from.y;
        const currLen = Math.sqrt(currDx * currDx + currDy * currDy);

        // Volgende beweging richting
        const nextDx = nextXYStep.to.x - nextXYStep.from.x;
        const nextDy = nextXYStep.to.y - nextXYStep.from.y;
        const nextLen = Math.sqrt(nextDx * nextDx + nextDy * nextDy);

        if (currLen < 0.001 || nextLen < 0.001) return { x: 0, y: 0 };

        // Normaliseer richtingen
        const v1x = currDx / currLen;
        const v1y = currDy / currLen;
        const v2x = nextDx / nextLen;
        const v2y = nextDy / nextLen;

        // Hoekbisector berekenen
        const bisectorX = v1x + v2x;
        const bisectorY = v1y + v2y;
        const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);

        let offsetDirX, offsetDirY;
        if (bisectorLen > 0.001) {
            offsetDirX = bisectorX / bisectorLen;
            offsetDirY = bisectorY / bisectorLen;
        } else {
            // 180 graden hoek
            offsetDirX = v1x;
            offsetDirY = v1y;
        }

        // Bereken offset aan juiste kant
        let nx, ny;
        if (side === 'left') {
            nx = -offsetDirY;
            ny = offsetDirX;
        } else {
            nx = offsetDirY;
            ny = -offsetDirX;
        }

        // Hoekfactor voor binnenbochten
        const dotProduct = v1x * v2x + v1y * v2y;
        const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
        const halfAngle = angle / 2;
        const offsetScale = halfAngle > 0.01 ? 1 / Math.sin(halfAngle) : 1;
        const limitedScale = Math.min(offsetScale, 3.0);

        return {
            x: nx * toolRadius * limitedScale * progress,
            y: ny * toolRadius * limitedScale * progress
        };
    }

    /**
     * calculateToolPosition - CENTRALE functie voor tool positie berekening met compensatie
     * 
     * Berekent de gecompenseerde tool positie op basis van:
     * - Huidige toolpath positie (currentPosition)
     * - Actieve compensatie mode (G40/G41/G42)
     * - Tool radius
     * - Laatste bewegingsstap (voor richting/arc info)
     * - Current step (voor transitie detectie)
     * 
     * @param {Object} position - Basis positie {x, y, z} (toolpath center)
     * @param {number} stepIndex - Index van huidige stap
     * @param {Object} lastMovementStep - Info over laatste beweging (voor richting/arc)
     * @returns {Object} - Gecompenseerde tool positie {x, y, z}
     */
    calculateToolPosition(position, stepIndex, lastMovementStep = null) {
        let toolPos = { ...position };

        // Geen compensatie als G40 of geen tool/radius
        if (this.radiusCompensation === 'G40' || !this.currentTool || !this.currentTool.radius) {
            return toolPos;
        }

        const toolRadius = this.currentTool.radius;
        const side = this.radiusCompensation === 'G41' ? 'left' : 'right';
        const currentStep = stepIndex >= 0 && stepIndex < this.animationSteps.length ? this.animationSteps[stepIndex] : null;

        console.log(`[calculateToolPosition] stepIndex=${stepIndex}, position=(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), comp=${this.radiusCompensation}, lastMovementStep=${lastMovementStep ? 'exists' : 'null'}`);

        // Bij deactivering transitie: geen offset
        if (currentStep && currentStep.isCompensationTransition && currentStep.isDeactivating) {
            if (this.verboseLogging) console.log(`[calculateToolPosition] Deactivation transition: tool at center`);
            return toolPos;
        }

        // Arc compensatie
        if (lastMovementStep && lastMovementStep.isArc) {
            const arcCenter = lastMovementStep.center;
            const arcRadius = lastMovementStep.radius;
            const isClockwise = lastMovementStep.isClockwise;

            const currentAngle = Math.atan2(
                position.y - arcCenter.y,
                position.x - arcCenter.x
            );

            let compensatedRadius;
            if (side === 'left') {
                compensatedRadius = isClockwise ? arcRadius + toolRadius : arcRadius - toolRadius;
            } else {
                compensatedRadius = isClockwise ? arcRadius - toolRadius : arcRadius + toolRadius;
            }

            toolPos.x = arcCenter.x + compensatedRadius * Math.cos(currentAngle);
            toolPos.y = arcCenter.y + compensatedRadius * Math.sin(currentAngle);

            if (this.verboseLogging) console.log(`[calculateToolPosition] Arc compensation: R=${compensatedRadius.toFixed(2)}`);
        }
        // Lineaire compensatie
        else if (lastMovementStep && !lastMovementStep.isArc) {
            // Check of de HUIDIGE stap (currentStep) een Z-only beweging is
            const currentStep = stepIndex >= 0 && stepIndex < this.animationSteps.length ? this.animationSteps[stepIndex] : null;
            let isCurrentStepZOnly = false;

            if (currentStep && currentStep.from && currentStep.to) {
                const currentDx = currentStep.to.x - currentStep.from.x;
                const currentDy = currentStep.to.y - currentStep.from.y;
                isCurrentStepZOnly = Math.hypot(currentDx, currentDy) <= 0.001;
            }

            // Als huidige stap Z-only is, gebruik vorige tool XY positie
            if (isCurrentStepZOnly) {
                console.log(`[calculateToolPosition] Z-only movement detected`);
                // Z-only beweging: behoud XY van vorige tool positie, alleen Z verandert
                if (this.lastToolXY) {
                    toolPos.x = this.lastToolXY.x;
                    toolPos.y = this.lastToolXY.y;
                    console.log(`[calculateToolPosition] Z-only: using previous tool XY=(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)}), new Z=${toolPos.z.toFixed(2)}`);
                } else {
                    console.log(`[calculateToolPosition] Z-only: no previous tool XY, using programmed position`);
                }
                return toolPos;  // Early return voor Z-only
            }

            // Niet Z-only: normale XY beweging compensatie

            // BELANGRIJK: Bij activering transitie GEEN corner compensation!
            // De tool moet alleen perpendiculair offset krijgen van de transitie-lijn
            const isActivatingTransition = currentStep && currentStep.isCompensationTransition && currentStep.isActivating;

            if (!isActivatingTransition) {
                // Alleen corner compensation als we NIET in activering zijn
                // Zoek volgende beweging voor corner compensation
                let nextStep = null;
                for (let i = stepIndex + 1; i < this.animationSteps.length; i++) {
                    const step = this.animationSteps[i];
                    if (step.from && step.to) {
                        const dx = step.to.x - step.from.x;
                        const dy = step.to.y - step.from.y;
                        if (Math.hypot(dx, dy) > 0.001) {
                            nextStep = step;
                            break;
                        }
                    }
                }

                // Corner compensatie (tussen twee lijnen)
                if (nextStep && !nextStep.arcData) {
                    const offsetPos = this.calculateToolOffsetAtCorner(lastMovementStep, position, nextStep, toolRadius, side);
                    if (offsetPos) {
                        toolPos.x = offsetPos.x;
                        toolPos.y = offsetPos.y;
                        console.log(`[calculateToolPosition] Corner compensation applied`);
                        return toolPos;
                    }
                }
            } else {
                console.log(`[calculateToolPosition] Activating transition - skipping corner compensation`);
            }

            // Segment compensatie: gebruik lastMovementStep richting
            // Bij activering: simpele perpendiculaire offset van transitie-lijn
            const segmentDx = lastMovementStep.to.x - lastMovementStep.from.x;
            const segmentDy = lastMovementStep.to.y - lastMovementStep.from.y;
            const segmentLength = Math.hypot(segmentDx, segmentDy);

            if (segmentLength > 0.001) {
                const v = this.normalizeVector({ x: segmentDx, y: segmentDy });
                const n = this.calculateNormal(v.x, v.y, side);
                toolPos.x += n.x * toolRadius;
                toolPos.y += n.y * toolRadius;
                console.log(`[calculateToolPosition] Segment compensation: offset=(${(n.x * toolRadius).toFixed(2)}, ${(n.y * toolRadius).toFixed(2)})`);
            }
        }

        return toolPos;
    }

    // Update only the tool position without re-rendering entire scene
    updateToolPosition() {
        if (!this.rotationHelper) return;

        console.log(`[updateToolPosition] ENTER: currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);

        const currentStep = this.animationSteps[this.currentStepIndex];

        // For activating transitions during animation, calculate progressive offset
        let toolPos;
        if (currentStep && currentStep.isCompensationTransition && currentStep.isActivating &&
            this.radiusCompensation !== 'G40' && this.currentTool && this.currentTool.radius) {

            toolPos = { ...this.currentPosition };
            const toolRadius = this.currentTool.radius;
            const side = this.radiusCompensation === 'G41' ? 'left' : 'right';

            // Zoek volgende XY beweging met helper functie
            const nextStep = this.findNextXYMovement(this.currentStepIndex + 1);

            if (nextStep) {
                // Bereken progressie langs transitie lijn
                const currDx = currentStep.to.x - currentStep.from.x;
                const currDy = currentStep.to.y - currentStep.from.y;
                const currLen = Math.sqrt(currDx * currDx + currDy * currDy);

                if (currLen > 0.001) {
                    const currentDx = this.currentPosition.x - currentStep.from.x;
                    const currentDy = this.currentPosition.y - currentStep.from.y;
                    const currentDist = Math.sqrt(currentDx * currentDx + currentDy * currentDy);
                    const progress = Math.min(1.0, currentDist / currLen);

                    // Gebruik helper functie voor offset berekening
                    const offset = this.calculateCompensationTransitionOffset(
                        currentStep, nextStep, toolRadius, side, progress
                    );

                    toolPos.x += offset.x;
                    toolPos.y += offset.y;

                    console.log(`[updateToolPosition] Activating compensation: progress=${(progress * 100).toFixed(1)}%, offset=(${offset.x.toFixed(2)}, ${offset.y.toFixed(2)})`);
                }
            }
        } else {
            // Bepaal lastMovementStep voor correcte compensatie berekening
            // Zoek de laatste stap met een beweging (from/to)
            let lastMovementStep = null;
            for (let i = this.currentStepIndex; i >= 0; i--) {
                const step = this.animationSteps[i];
                if (step.from && step.to) {
                    if (step.arcData) {
                        // Arc beweging
                        lastMovementStep = {
                            from: step.arcData.start,
                            to: step.arcData.end,
                            isArc: true,
                            center: step.arcData.center,
                            isClockwise: step.command === 'G2',
                            radius: Math.sqrt(
                                Math.pow(step.arcData.start.x - step.arcData.center.x, 2) +
                                Math.pow(step.arcData.start.y - step.arcData.center.y, 2)
                            )
                        };
                    } else {
                        // Lineaire beweging
                        lastMovementStep = {
                            from: step.from,
                            to: step.to
                        };
                    }
                    break;
                }
            }

            // Use central calculation function for all other cases
            toolPos = this.calculateToolPosition(this.currentPosition, this.currentStepIndex, lastMovementStep);
        }

        // Transform position considering current rotation/offset
        const transformed = this.transformPoint(toolPos.x, toolPos.y, toolPos.z);

        console.log(`[updateToolPosition] FINAL: toolPos=(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)}, ${toolPos.z.toFixed(2)}) → world=(${transformed.x.toFixed(2)}, ${transformed.y.toFixed(2)}, ${transformed.z.toFixed(2)})`);

        // Update tool position
        this.rotationHelper.position.set(transformed.x, transformed.y, transformed.z);

        // Update tool rotation to match current AROT
        this.rotationHelper.rotation.order = 'ZYX';
        this.rotationHelper.rotation.x = THREE.MathUtils.degToRad(this.currentRotation.x);
        this.rotationHelper.rotation.y = THREE.MathUtils.degToRad(this.currentRotation.z);
        this.rotationHelper.rotation.z = THREE.MathUtils.degToRad(-this.currentRotation.y);
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

    jumpToStep(stepIndex) {
        // Jump to a specific step in the animation
        if (stepIndex < 0 || stepIndex >= this.animationSteps.length) {
            console.warn(`Invalid step index: ${stepIndex}`);
            return;
        }

        // Stop animation if running
        this.stopAnimation();

        // Set the current step and render up to it
        this.currentStepIndex = stepIndex;
        const step = this.animationSteps[stepIndex];

        console.log(`Jumping to step ${stepIndex + 1}/${this.animationSteps.length}:`, step);

        this.renderUpToStep(stepIndex);
        this.updateAnimationUI(stepIndex, this.animationSteps.length, step);

        // Move to next step so play will continue from here
        this.currentStepIndex = stepIndex + 1;
    }

    setAnimationSpeed(speed) {
        this.animationSpeed = speed;
        localStorage.setItem('cncAnimationSpeed', speed);
        console.log(`Animation speed set to ${speed} ms`);
    }

    // Helper: Calculate normal vector (perpendicular)
    calculateNormal(dx, dy, side) {
        if (side === "left") return { x: -dy, y: dx };
        else return { x: dy, y: -dx };
    }

    // Helper: Normalize vector
    normalizeVector(v) {
        const L = Math.hypot(v.x, v.y);
        if (L < 0.0001) return { x: 0, y: 0 };
        return { x: v.x / L, y: v.y / L };
    }

    // Helper: Line intersection
    intersectLines(p1, p2, p3, p4) {
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;
        const x3 = p3.x, y3 = p3.y;
        const x4 = p4.x, y4 = p4.y;

        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-8) return null;

        const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
        const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;

        return { x: px, y: py };
    }

    // Calculate tool offset position at corner using line intersection method
    calculateToolOffsetAtCorner(prevMove, currPos, nextMove, radius, side) {
        if (!prevMove || !nextMove) return null;

        // Direction vectors
        const v1 = this.normalizeVector({
            x: currPos.x - prevMove.from.x,
            y: currPos.y - prevMove.from.y
        });
        const v2 = this.normalizeVector({
            x: nextMove.to.x - currPos.x,
            y: nextMove.to.y - currPos.y
        });

        // Normal vectors (perpendicular offsets)
        const n1 = this.calculateNormal(v1.x, v1.y, side);
        const n2 = this.calculateNormal(v2.x, v2.y, side);

        // Offset lines from corner point
        const p1 = { x: currPos.x + n1.x * radius, y: currPos.y + n1.y * radius };
        const p2 = { x: currPos.x + n2.x * radius, y: currPos.y + n2.y * radius };

        // Calculate intersection of offset lines - this is the correct tool center position
        const prevPt = { x: prevMove.from.x + n1.x * radius, y: prevMove.from.y + n1.y * radius };
        const nextPt = { x: nextMove.to.x + n2.x * radius, y: nextMove.to.y + n2.y * radius };

        const intersection = this.intersectLines(prevPt, p1, p2, nextPt);

        return intersection || p1; // Fallback to simple offset
    }

    /**
     * clearRenderedToolpath - Verwijder alle gerenderde toolpath lijnen
     * 
     * Behoudt:
     * - Assen (axes)
     * - Lichten (lights)
     * - Deur outline en oppervlak
     * - Tool visualisatie (rotationHelper)
     * 
     * Verwijdert:
     * - Alle toolpath lijnen (cutting en rapid)
     * - Partiële lijnen tijdens animatie
     * 
     * Gebruikt voor:
     * - Opnieuw renderen tijdens animatie
     * - Stapsgewijze visualisatie (renderUpToStep)
     */
    clearRenderedToolpath() {
        // Verwijder alle objecten behalve assen, lichten, deur en tool
        const objectsToRemove = [];
        this.scene.traverse((object) => {
            // Check if object is the door outline, surface, or door parts
            let isDoorObject = (object === this.doorOutline) ||
                (this.doorOutline && this.doorOutline.userData.surface === object);
            
            // Check door parts array
            if (!isDoorObject && this.doorOutline && this.doorOutline.userData.doorParts) {
                isDoorObject = this.doorOutline.userData.doorParts.includes(object);
            }
            
            // Check all edges array
            if (!isDoorObject && this.doorOutline && this.doorOutline.userData.allEdges) {
                isDoorObject = this.doorOutline.userData.allEdges.includes(object);
            }
            
            // Check folds array (if visible)
            if (!isDoorObject && this.doorOutline && this.doorOutline.userData.folds) {
                isDoorObject = this.doorOutline.userData.folds.includes(object);
            }

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

        // Also clear partial line if it exists
        if (this.partialLine) {
            this.scene.remove(this.partialLine);
            if (this.partialLine.geometry) this.partialLine.geometry.dispose();
            if (this.partialLine.material) this.partialLine.material.dispose();
            this.partialLine = null;
        }
    }

    /**
     * renderUpToStep - Render alle stappen tot en met stepIndex
     * 
     * Deze functie wordt MEERDERE KEREN aangeroepen tijdens animatie:
     * - Stap 0: render 0
     * - Stap 1: render 0-1
     * - Stap 2: render 0-2 (stap 0 en 1 worden OPNIEUW uitgevoerd!)
     * 
     * KRITIEK: Functies hier mogen GEEN currentPosition wijzigen!
     * - TRANS: mag alleen currentOffset updaten (voor transformPoint)
     * - AROT: mag alleen currentRotation updaten (voor rotationMatrix)
     * - Alle positie wijzigingen gebeuren ALLEEN in parseGCode!
     * 
     * @param {number} stepIndex - Index van laatste stap om te renderen
     * @param {boolean} skipToolUpdate - true = teken lijnen maar niet tool (voorkomt flikkeren)
     */
    renderUpToStep(stepIndex, skipToolUpdate = false) {
        // Verwijder huidige rendering
        this.clearRenderedToolpath();

        // KRITIEK: Bewaar currentPosition en radiusCompensation state!
        // Deze functie wordt in een loop aangeroepen tijdens animatie.
        // We moeten de originele state herstellen aan het einde om animatie niet te verstoren.
        const savedPosition = { ...this.currentPosition };
        const savedPreviousPosition = { ...this.previousPosition };
        const savedRadiusComp = this.radiusCompensation;
        const savedRotation = { ...this.currentRotation };
        const savedOffset = { ...this.currentOffset };

        const cuttingPoints = [];
        const rapidPoints = [];
        let lastMovementStep = null;

        // Render all steps up to stepIndex
        for (let i = 0; i <= stepIndex && i < this.animationSteps.length; i++) {
            const step = this.animationSteps[i];

            // Handle rotation commands (AROT) - NO position change, only rotation
            if (step.isRotation && step.from && step.to) {
                console.log(`[renderUpToStep] AROT step detected: isRotation=${step.isRotation}, from=${JSON.stringify(step.from)}, to=${JSON.stringify(step.to)}`);
                this.currentRotation = step.to;
                this.updateRotationMatrix();
                // AROT does NOT change position - skip lastMovementStep
                continue;
            }

            // Handle translation commands (TRANS) - NO position change at render time
            if (step.isTranslation && step.from && step.to) {
                // TRANS verschuift het nulpunt van het coördinatenstelsel
                // 
                // KRITIEK: currentPosition is AL aangepast tijdens parseGCode!
                // renderUpToStep wordt MEERDERE KEREN aangeroepen:
                //   - render stap 0-11 (TRANS op stap 11 uitgevoerd)
                //   - render stap 0-12 (TRANS op stap 11 OPNIEUW uitgevoerd!) ← BUG
                //   - render stap 0-13 (TRANS op stap 11 NOGMAALS uitgevoerd!) ← BUG
                // 
                // Als we hier currentPosition aanpassen → cumulatieve fout!
                // Voorbeeld: TRANS delta=(-2050,-645,0)
                //   1e keer: pos (0,665) → (-2050,-645)    ✓ correct
                //   2e keer: pos (-2050,-645) → (-4100,-1290)  ✗ FOUT!
                // 
                // OPLOSSING: Alleen currentOffset updaten (nodig voor transformPoint)
                //            currentPosition NIET aanpassen (al gedaan tijdens parsing)

                this.currentOffset = step.to;  // Update offset voor coördinaat transformatie

                if (this.verboseLogging) console.log(`[renderUpToStep] TRANS: offset updated to (${step.to.x}, ${step.to.y}, ${step.to.z})`);
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
                console.log(`[renderUpToStep] Tool change: PL=${step.pl}, D=${step.d}`);

                // NIET this.currentPosition.z updaten hier!
                // 
                // Waarom niet?
                // - currentPosition wordt bijgehouden via lastMovementStep aan het einde
                // - Tool visueel naar safeZ bewegen gebeurt alleen voor tool model
                // - Toolpath lijnen moeten werkelijke posities gebruiken
                // 
                // De tool zal visueel naar step.to.z (safeZ) bewogen worden
                // als dit de laatste stap is via lastMovementStep logica onderaan

                // MAAR: track dit WEL als laatste beweging voor correcte tool positie
                if (step.from && step.to) {
                    lastMovementStep = {
                        from: step.from,
                        to: step.to,
                        isToolChange: true,
                        radiusCompensation: this.radiusCompensation
                    };
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

                // Track this as last movement with arc info
                lastMovementStep = {
                    from: start,
                    to: end,
                    isArc: true,
                    center: center,
                    isClockwise: isClockwise,
                    radius: radius,
                    radiusCompensation: this.radiusCompensation  // Track comp state
                };
            } else if (step.from && step.to && !step.isRotation && !step.isTranslation && !step.isReset) {
                // Handle linear moves (G0/G1) - but NOT rotation/translation/reset commands
                // AROT, TRANS, TRAFOOF have from/to but are NOT position movements
                const from = this.transformPoint(step.from.x, step.from.y, step.from.z);
                const to = this.transformPoint(step.to.x, step.to.y, step.to.z);

                console.log(`[renderUpToStep] Drawing line: from=(${step.from.x.toFixed(2)}, ${step.from.y.toFixed(2)}, ${step.from.z.toFixed(2)}) to=(${step.to.x.toFixed(2)}, ${step.to.y.toFixed(2)}, ${step.to.z.toFixed(2)}) ${step.isRapid ? 'RAPID' : 'CUTTING'}`);

                if (step.isRapid) {
                    rapidPoints.push(from, to);
                } else {
                    cuttingPoints.push(from, to);
                }

                // Track this as last movement
                lastMovementStep = {
                    from: step.from,
                    to: step.to,
                    radiusCompensation: this.radiusCompensation  // Track comp state
                };
            }
        }

        // Update position tracking based on last movement
        // MAAR: als skipToolUpdate=true (tijdens animatie), herstel de originele state!
        // Anders wordt de animatie startpositie overschreven.
        if (lastMovementStep) {
            console.log(`[renderUpToStep] lastMovementStep found: from=${JSON.stringify(lastMovementStep.from)}, to=${JSON.stringify(lastMovementStep.to)}, isToolChange=${lastMovementStep.isToolChange}, isArc=${lastMovementStep.isArc}`);
            this.previousPosition = { ...lastMovementStep.from };
            this.currentPosition = { ...lastMovementStep.to };
            console.log(`[renderUpToStep] POSITION UPDATE: previousPosition=(${this.previousPosition.x.toFixed(2)}, ${this.previousPosition.y.toFixed(2)}, ${this.previousPosition.z.toFixed(2)}) currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
            if (this.verboseLogging) console.log(`[renderUpToStep] Position: (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
        } else if (!lastMovementStep) {
            console.log(`[renderUpToStep] NO lastMovementStep - currentPosition remains: (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
            if (this.verboseLogging) console.log(`[renderUpToStep] No movement steps found, currentPosition remains: (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
        }

        // HERSTEL state als we tijdens animatie zijn (skipToolUpdate=true)
        // Anders verstoort renderUpToStep de animatie interpolatie
        // 
        // LET OP: currentOffset en currentRotation worden NIET hersteld!
        // Deze zijn permanente transformaties (TRANS/AROT) die behouden moeten blijven.
        // Alleen currentPosition en radiusCompensation zijn tijdelijk tijdens rendering.
        if (skipToolUpdate) {
            this.currentPosition = savedPosition;
            this.previousPosition = savedPreviousPosition;
            this.radiusCompensation = savedRadiusComp;
            // NIET: this.currentRotation = savedRotation;  // AROT is permanent
            // NIET: this.currentOffset = savedOffset;      // TRANS is permanent
            if (this.verboseLogging) console.log(`[renderUpToStep] State restored for animation: currentPosition=(${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)}, ${this.currentPosition.z.toFixed(2)})`);
        }

        // Update/create tool indicator if needed (only if we have a valid tool)
        // Create rotation helper if it doesn't exist OR if tool has changed
        if (!this.rotationHelper || this.rotationHelper._currentToolId !== (this.currentTool ? `${this.currentPL}_${this.currentD}` : null)) {
            this.updateRotationHelper();
            if (this.rotationHelper) {
                this.rotationHelper._currentToolId = this.currentTool ? `${this.currentPL}_${this.currentD}` : null;
            }
        }

        // Only update tool position if not about to animate (to avoid flicker)
        if (this.rotationHelper && !skipToolUpdate) {
            if (this.verboseLogging) console.log(`[renderUpToStep] Starting compensation check: comp=${this.radiusCompensation}, tool=${this.currentTool ? this.currentTool.name : 'none'}, radius=${this.currentTool ? this.currentTool.radius : 'N/A'}`);

            // Use central calculateToolPosition function
            const toolPos = this.calculateToolPosition(this.currentPosition, stepIndex, lastMovementStep);

            // Save tool XY position for Z-only movements
            this.lastToolXY = { x: toolPos.x, y: toolPos.y };

            const worldPos = this.transformPoint(toolPos.x, toolPos.y, toolPos.z);
            console.log(`[renderUpToStep] Setting tool position: CNC=(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)}, ${toolPos.z.toFixed(2)}) → World=(${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})`);
            this.rotationHelper.position.copy(worldPos);

            // Save tool XY position for Z-only movements
            this.lastToolXY = { x: toolPos.x, y: toolPos.y };

            // Update tool rotation to match current AROT
            this.rotationHelper.rotation.order = 'ZYX';
            this.rotationHelper.rotation.x = THREE.MathUtils.degToRad(this.currentRotation.x);
            this.rotationHelper.rotation.y = THREE.MathUtils.degToRad(this.currentRotation.z);
            this.rotationHelper.rotation.z = THREE.MathUtils.degToRad(-this.currentRotation.y);

            if (this.verboseLogging) console.log(`[renderUpToStep] Final tool position - CNC:(${toolPos.x.toFixed(2)}, ${toolPos.y.toFixed(2)}, ${toolPos.z.toFixed(2)}) World:(${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})`);
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

                // Add feedrate info if available
                if (stepData.feedrate && stepData.feedrate > 0 && !stepData.isRapid) {
                    html += `<div class="anim-info"><strong>Feedrate:</strong> ${stepData.feedrate} mm/min (${(stepData.feedrate / 60).toFixed(1)} mm/s)</div>`;
                }
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

// Set camera to predefined position
export function setCameraPosition(position) {
    if (!cncViewer || !cncViewer.camera || !cncViewer.controls) {
        return;
    }

    const camera = cncViewer.camera;
    const controls = cncViewer.controls;

    // Get bounding box to position camera appropriately
    const box = new THREE.Box3();
    cncViewer.scene.traverse((object) => {
        if (object.isMesh) {
            box.expandByObject(object);
        }
    });

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Calculate optimal distance based on view direction and canvas size
    const canvas = cncViewer.renderer.domElement;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const fov = camera.fov * (Math.PI / 180); // Convert to radians

    let distance;

    switch (position) {
        case 'top':
        case 'bottom':
            // Looking down/up - need to fit X and Z dimensions (closer view)
            const horizontalSize = Math.max(size.x, size.z);
            const verticalSize = aspect > 1 ? horizontalSize / aspect : horizontalSize * aspect;
            distance = Math.max(horizontalSize, verticalSize) / (2 * Math.tan(fov / 2)) * 0.85;
            break;

        case 'front':
        case 'back':
            // Looking along Z axis - need to fit X and Y dimensions
            const widthXY = size.x;
            const heightXY = size.y;
            const horizontalFit = widthXY / (2 * Math.tan(fov / 2) * aspect);
            const verticalFit = heightXY / (2 * Math.tan(fov / 2));
            distance = Math.max(horizontalFit, verticalFit) * 1.1;
            break;

        case 'right':
        case 'left':
            // Looking along X axis - fixed distance
            distance = 1600;
            break;

        case 'iso':
            // Isometric view - fixed distance
            distance = 2000;
            break;

        default:
            const defaultMaxDim = Math.max(size.x, size.y, size.z);
            distance = defaultMaxDim * 2;
    }

    controls.target.copy(center);

    switch (position) {
        case 'top':
            camera.position.set(center.x, center.y + distance, center.z);
            camera.up.set(0, 1, 0); // Keep standard up vector for isometric-like behavior
            break;
        case 'bottom':
            camera.position.set(center.x, center.y - distance, center.z);
            camera.up.set(0, 1, 0); // Keep standard up vector
            break;
        case 'front':
            camera.position.set(center.x, center.y, center.z + distance);
            camera.up.set(0, 1, 0);
            break;
        case 'back':
            camera.position.set(center.x, center.y, center.z - distance);
            camera.up.set(0, 1, 0);
            break;
        case 'right':
            camera.position.set(center.x + distance, center.y, center.z);
            camera.up.set(0, 1, 0);
            break;
        case 'left':
            camera.position.set(center.x - distance, center.y, center.z);
            camera.up.set(0, 1, 0);
            break;
        case 'iso':
            camera.position.set(
                center.x + distance * 0.7,
                center.y + distance * 0.7,
                center.z + distance * 0.7
            );
            camera.up.set(0, 1, 0);
            break;
    }

    controls.update();
    camera.updateProjectionMatrix();
}

// Start recording
export function startRecording(format) {
    if (cncViewer) {
        cncViewer.startRecording(format);
    }
}

// Stop recording
export function stopRecording() {
    if (cncViewer) {
        cncViewer.stopRecording();
    }
}
