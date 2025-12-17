import { cncViewer, initViewer, visualizeGCode, clearViewer, setCameraPosition, startRecording, stopRecording } from './viewer.js';

// API base URL
const API_BASE = 'http://localhost:5000';

// State
let currentPath = '';
let currentFile = null;
let allFiles = [];
let lastVisitedFolder = ''; // Track last visited folder for highlighting
let ffmpegAvailable = false; // Track FFmpeg availability for recording buttons

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Restore previous state if available
    const savedState = sessionStorage.getItem('cncViewerState');
    if (savedState) {
        const state = JSON.parse(savedState);
        currentPath = state.currentPath || '';
        const savedFile = state.currentFile;
        
        // Load the saved directory
        loadDirectory(currentPath).then(() => {
            // If there was a file open, reload it (use path property if it's an object)
            if (savedFile) {
                const filePath = typeof savedFile === 'string' ? savedFile : savedFile.path;
                if (filePath) {
                    loadFile(filePath);
                }
            }
        });
    } else {
        loadDirectory('');
    }
    
    setupEventListeners();
    checkFFmpegAvailability();
    
    // Save state before navigating away
    window.addEventListener('beforeunload', saveState);
});

// Check if FFmpeg is available on server
async function checkFFmpegAvailability() {
    try {
        const response = await fetch(`${API_BASE}/api/check-ffmpeg`);
        const data = await response.json();
        
        ffmpegAvailable = data.available; // Store FFmpeg availability
        
        const recordButtons = document.querySelector('.record-buttons');
        const recordMP4Btn = document.getElementById('recordMP4Btn');
        const recordAVIBtn = document.getElementById('recordAVIBtn');
        const recordGIFBtn = document.getElementById('recordGIFBtn');
        const recordWebMBtn = document.getElementById('recordWebMBtn');
        
        if (recordButtons) {
            // Always show record buttons container
            recordButtons.style.display = 'flex';
            
            if (ffmpegAvailable) {
                // FFmpeg available - show all buttons
                if (recordWebMBtn) recordWebMBtn.style.display = 'inline-block';
                if (recordMP4Btn) recordMP4Btn.style.display = 'inline-block';
                if (recordAVIBtn) recordAVIBtn.style.display = 'inline-block';
                if (recordGIFBtn) recordGIFBtn.style.display = 'inline-block';
                console.log('FFmpeg beschikbaar - alle opname knoppen zichtbaar');
            } else {
                // FFmpeg not available - only show WebM button
                if (recordWebMBtn) recordWebMBtn.style.display = 'inline-block';
                if (recordMP4Btn) recordMP4Btn.style.display = 'none';
                if (recordAVIBtn) recordAVIBtn.style.display = 'none';
                if (recordGIFBtn) recordGIFBtn.style.display = 'none';
                console.log('FFmpeg niet beschikbaar - alleen WebM knop zichtbaar');
            }
        }
    } catch (error) {
        console.error('Fout bij checken FFmpeg:', error);
        ffmpegAvailable = false; // Set to false on error
        
        // On error, still show WebM button (native format)
        const recordButtons = document.querySelector('.record-buttons');
        const recordMP4Btn = document.getElementById('recordMP4Btn');
        const recordAVIBtn = document.getElementById('recordAVIBtn');
        const recordGIFBtn = document.getElementById('recordGIFBtn');
        const recordWebMBtn = document.getElementById('recordWebMBtn');
        
        if (recordButtons) {
            recordButtons.style.display = 'flex';
            if (recordWebMBtn) recordWebMBtn.style.display = 'inline-block';
            if (recordMP4Btn) recordMP4Btn.style.display = 'none';
            if (recordAVIBtn) recordAVIBtn.style.display = 'none';
            if (recordGIFBtn) recordGIFBtn.style.display = 'none';
        }
    }
}

// Save current state
function saveState() {
    const state = {
        currentPath: currentPath,
        currentFile: currentFile ? currentFile.path : null // Only save path, not entire object
    };
    sessionStorage.setItem('cncViewerState', JSON.stringify(state));
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const downloadBtn = document.getElementById('downloadBtn');
    const copyBtn = document.getElementById('copyBtn');
    const visualizeBtn = document.getElementById('visualizeBtn');
    const clearViewerBtn = document.getElementById('clearViewerBtn');
    const showStatsBtn = document.getElementById('showStatsBtn');
    const closeStatsModal = document.getElementById('closeStatsModal');
    const statsModal = document.getElementById('statsModal');
    const cameraPositionSelect = document.getElementById('cameraPositionSelect');
    
    // Recording buttons
    const recordWebMBtn = document.getElementById('recordWebMBtn');
    const recordMP4Btn = document.getElementById('recordMP4Btn');
    const recordAVIBtn = document.getElementById('recordAVIBtn');
    const recordGIFBtn = document.getElementById('recordGIFBtn');
    const stopRecordBtn = document.getElementById('stopRecordBtn');
    
    // Settings modal
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const settingsModal = document.getElementById('settingsModal');
    const addVariableBtn = document.getElementById('addVariableBtn');
    
    // Animation controls
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stepBackBtn = document.getElementById('stepBackBtn');
    const stepForwardBtn = document.getElementById('stepForwardBtn');
    const resetBtn = document.getElementById('resetBtn');
    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');

    // Load saved speed from localStorage
    const savedSpeed = parseInt(localStorage.getItem('cncAnimationSpeed')) || 100;
    if (speedSlider && speedValue) {
        speedSlider.value = savedSpeed;
        speedValue.textContent = `${savedSpeed} ms`;
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterFiles(e.target.value);
        });
    }
    
    // Stats modal controls
    if (showStatsBtn) {
        showStatsBtn.addEventListener('click', () => {
            statsModal.classList.add('active');
        });
    }
    
    if (closeStatsModal) {
        closeStatsModal.addEventListener('click', () => {
            statsModal.classList.remove('active');
        });
    }
    
    // Close modal when clicking outside
    if (statsModal) {
        statsModal.addEventListener('click', (e) => {
            if (e.target === statsModal) {
                statsModal.classList.remove('active');
            }
        });
    }

    // Settings modal controls
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('active');
            loadSettingsUI();
        });
    }
    
    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });
    }
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('active');
            }
        });
    }

    if (addVariableBtn) {
        addVariableBtn.addEventListener('click', () => {
            addMachineVariable();
        });
    }

    if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentFile);
    if (copyBtn) copyBtn.addEventListener('click', copyCodeToClipboard);
    if (visualizeBtn) visualizeBtn.addEventListener('click', visualizeCurrentFile);
    if (clearViewerBtn) {
        clearViewerBtn.addEventListener('click', () => {
            if (cncViewer) {
                cncViewer.clear();
                clearViewer();
            }
        });
    }
    
    // Camera position selector
    if (cameraPositionSelect) {
        cameraPositionSelect.addEventListener('change', (e) => {
            const position = e.target.value;
            if (position) {
                setCameraPosition(position);
                // Reset to placeholder after selection
                setTimeout(() => {
                    e.target.value = '';
                }, 100);
            }
        });
    }
    
    // Recording controls
    if (recordWebMBtn) {
        recordWebMBtn.addEventListener('click', () => {
            startRecording('webm');
            recordWebMBtn.classList.add('recording');
            recordMP4Btn.style.display = 'none';
            recordAVIBtn.style.display = 'none';
            recordGIFBtn.style.display = 'none';
            stopRecordBtn.style.display = 'inline-block';
        });
    }
    
    if (recordMP4Btn) {
        recordMP4Btn.addEventListener('click', () => {
            startRecording('mp4');
            recordMP4Btn.classList.add('recording');
            recordWebMBtn.style.display = 'none';
            recordAVIBtn.style.display = 'none';
            recordGIFBtn.style.display = 'none';
            stopRecordBtn.style.display = 'inline-block';
        });
    }
    
    if (recordAVIBtn) {
        recordAVIBtn.addEventListener('click', () => {
            startRecording('avi');
            recordAVIBtn.classList.add('recording');
            recordWebMBtn.style.display = 'none';
            recordMP4Btn.style.display = 'none';
            recordGIFBtn.style.display = 'none';
            stopRecordBtn.style.display = 'inline-block';
        });
    }
    
    if (recordGIFBtn) {
        recordGIFBtn.addEventListener('click', () => {
            startRecording('gif');
            recordGIFBtn.classList.add('recording');
            recordWebMBtn.style.display = 'none';
            recordMP4Btn.style.display = 'none';
            recordAVIBtn.style.display = 'none';
            stopRecordBtn.style.display = 'inline-block';
        });
    }
    
    if (stopRecordBtn) {
        stopRecordBtn.addEventListener('click', () => {
            stopRecording();
            recordWebMBtn.classList.remove('recording');
            recordMP4Btn.classList.remove('recording');
            recordAVIBtn.classList.remove('recording');
            recordGIFBtn.classList.remove('recording');
            
            // Always show WebM button
            recordWebMBtn.style.display = 'inline-block';
            
            // Only show FFmpeg-dependent buttons if FFmpeg is available
            if (ffmpegAvailable) {
                recordMP4Btn.style.display = 'inline-block';
                recordAVIBtn.style.display = 'inline-block';
                recordGIFBtn.style.display = 'inline-block';
            } else {
                recordMP4Btn.style.display = 'none';
                recordAVIBtn.style.display = 'none';
                recordGIFBtn.style.display = 'none';
            }
            
            stopRecordBtn.style.display = 'none';
        });
    }
    
    // Resizer functionality
    const resizer = document.getElementById('resizer');
    const codePanel = document.querySelector('.code-panel');
    const viewerPanel = document.querySelector('.viewer-panel');
    
    if (resizer && codePanel && viewerPanel) {
        let isResizing = false;
        
        // Load saved position
        const savedPosition = localStorage.getItem('resizerPosition');
        if (savedPosition) {
            const percentage = parseFloat(savedPosition);
            codePanel.style.flex = `0 0 ${percentage}%`;
            viewerPanel.style.flex = `0 0 ${100 - percentage}%`;
        }
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const container = document.querySelector('.content-split');
            const containerRect = container.getBoundingClientRect();
            const newCodeWidth = e.clientX - containerRect.left;
            
            // Min/max constraints
            const minWidth = 300;
            const maxWidth = containerRect.width - 300;
            
            if (newCodeWidth >= minWidth && newCodeWidth <= maxWidth) {
                const percentage = (newCodeWidth / containerRect.width) * 100;
                codePanel.style.flex = `0 0 ${percentage}%`;
                viewerPanel.style.flex = `0 0 ${100 - percentage}%`;
                
                // Trigger resize event for 3D viewer
                if (cncViewer) {
                    cncViewer.onWindowResize();
                }
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // Save position to localStorage
                const container = document.querySelector('.content-split');
                const containerRect = container.getBoundingClientRect();
                const codePanelRect = codePanel.getBoundingClientRect();
                const percentage = (codePanelRect.width / containerRect.width) * 100;
                localStorage.setItem('resizerPosition', percentage.toString());
            }
        });
    }
    
    // Animation event listeners
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            console.log('Play button clicked');
            if (cncViewer && cncViewer.animationSteps) {
                console.log('Starting animation, steps available:', cncViewer.animationSteps.length);
                cncViewer.startAnimation();
            } else {
                console.log('No viewer initialized');
            }
        });
    }
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            console.log('Pause button clicked');
            if (cncViewer) cncViewer.stopAnimation();
        });
    }
    if (stepBackBtn) {
        stepBackBtn.addEventListener('click', () => {
            console.log('Step back clicked');
            if (cncViewer) cncViewer.stepBackward();
        });
    }
    if (stepForwardBtn) {
        stepForwardBtn.addEventListener('click', () => {
            console.log('Step forward clicked');
            if (cncViewer) cncViewer.stepForward();
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            console.log('Reset clicked');
            if (cncViewer) cncViewer.resetAnimation();
        });
    }

    if (speedSlider && speedValue) {
        speedSlider.addEventListener('input', (e) => {
            const speed = parseInt(e.target.value);
            speedValue.textContent = `${speed} ms`;
            if (cncViewer) {
                cncViewer.setAnimationSpeed(speed);
            }
        });
    }
    
    // Tool switch selector
    const toolSwitchSelect = document.getElementById('toolSwitchSelect');
    if (toolSwitchSelect) {
        toolSwitchSelect.addEventListener('change', (e) => {
            const stepIndex = parseInt(e.target.value);
            if (!isNaN(stepIndex) && cncViewer) {
                cncViewer.jumpToStep(stepIndex);
            }
        });
    }
}

// Load directory contents
async function loadDirectory(path) {
    const fileTree = document.getElementById('fileTree');
    fileTree.innerHTML = '<div class="loading">Laden...</div>';

    try {
        const response = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error('Failed to load directory');
        
        const data = await response.json();
        currentPath = data.current_path;
        allFiles = data.items;
        
        updateBreadcrumb(data.current_path);
        renderFileTree(data.items, data.parent_path);
    } catch (error) {
        console.error('Error loading directory:', error);
        fileTree.innerHTML = '<div class="loading">Fout bij laden van bestanden</div>';
    }
}

// Render file tree
function renderFileTree(items, parentPath) {
    const fileTree = document.getElementById('fileTree');
    fileTree.innerHTML = '';

    // Add parent directory link if not at root
    if (parentPath !== null) {
        const backItem = createFileTreeItem('.. (Terug)', 'back', () => {
            // Don't reset lastVisitedFolder - we want to highlight where we came from
            loadDirectory(parentPath);
        });
        fileTree.appendChild(backItem);
    }

    // Items are already sorted by modification date (newest first) from server
    // No additional sorting needed here
    
    // Render items
    items.forEach(item => {
        const element = createFileTreeItem(
            item.name,
            item.type,
            () => handleItemClick(item),
            item.path === lastVisitedFolder // Highlight if this was the last visited folder
        );
        fileTree.appendChild(element);
    });

    if (items.length === 0 && parentPath === null) {
        fileTree.innerHTML = '<div class="loading">Geen bestanden gevonden</div>';
    }
    
    // Auto-select and visualize _K1 file if found
    autoSelectK1File(items);
}

// Automatically select and visualize _K1 file
function autoSelectK1File(items) {
    // Look for a file ending with _K1 before the extension
    const k1File = items.find(item => {
        if (item.type !== 'file') return false;
        // Match pattern: filename_K1.extension (case insensitive)
        return /_K1\./i.test(item.name);
    });
    
    if (k1File) {
        console.log(`Auto-selecting _K1 file: ${k1File.name}`);
        
        // Find and highlight the file in the tree
        const fileTreeItems = document.querySelectorAll('.file-tree-item.file');
        fileTreeItems.forEach(item => {
            if (item.textContent === k1File.name) {
                item.classList.add('active');
            }
        });
        
        // Load the file and visualize it
        loadFile(k1File.path, k1File.name, null).then(() => {
            // Small delay to ensure file is loaded before visualizing
            setTimeout(() => {
                visualizeCurrentFile();
            }, 200);
        });
    }
}

// Create file tree item element
function createFileTreeItem(name, type, clickHandler, shouldHighlight = false) {
    const div = document.createElement('div');
    div.className = `file-tree-item ${type}`;
    if (shouldHighlight) {
        div.classList.add('last-visited');
    }
    div.textContent = name;
    div.addEventListener('click', clickHandler);
    return div;
}

// Handle item click
function handleItemClick(item) {
    if (item.type === 'folder') {
        lastVisitedFolder = item.path; // Remember this folder
        loadDirectory(item.path);
        clearCodeViewer();
    } else {
        loadFile(item.path, item.name, event);
    }
}

// Load and display file content
async function loadFile(path, name, clickEvent) {
    const codeContent = document.getElementById('codeContent');
    const fileName = document.getElementById('fileName');
    const downloadBtn = document.getElementById('downloadBtn');
    const copyBtn = document.getElementById('copyBtn');
    const visualizeBtn = document.getElementById('visualizeBtn');

    codeContent.innerHTML = '<code>Laden...</code>';
    fileName.textContent = name;

    try {
        const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error('Failed to load file');
        
        const data = await response.json();
        currentFile = { path, name, content: data.content, parameters: data.parameters };
        
        console.log('File loaded with parameters:', data.parameters);
        
        displayCode(data.content);
        updateFileInfo(data);
        
        // Show door parameters if available
        if (data.parameters) {
            displayDoorParameters(data.parameters);
        }
        
        downloadBtn.disabled = false;
        copyBtn.disabled = false;
        visualizeBtn.disabled = false;
        
        // Save state
        saveState();
        
        // Highlight active file in tree
        document.querySelectorAll('.file-tree-item').forEach(item => {
            item.classList.remove('active');
        });
        if (clickEvent && clickEvent.target) {
            clickEvent.target.classList.add('active');
        }
    } catch (error) {
        console.error('Error loading file:', error);
        codeContent.innerHTML = '<code>Fout bij laden van bestand</code>';
        downloadBtn.disabled = true;
        copyBtn.disabled = true;
        visualizeBtn.disabled = true;
    }
}

// Display code with line numbers
function displayCode(content) {
    const codeContent = document.getElementById('codeContent');
    const lines = content.split('\n');
    
    let html = '<code>';
    lines.forEach((line, index) => {
        const lineNum = index + 1;
        const escapedLine = escapeHtml(line);
        html += `<span class="code-line" data-line-number="${lineNum}"><span class="line-number">${lineNum}</span>${escapedLine}</span>\n`;
    });
    html += '</code>';
    
    codeContent.innerHTML = html;
}

// Escape HTML entities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Highlight a specific line in the code viewer
function highlightCodeLine(lineNumber) {
    const codeContent = document.getElementById('codeContent');
    if (!codeContent) return;
    
    // Remove previous highlighting
    const previousActive = codeContent.querySelector('.active-line');
    if (previousActive) {
        previousActive.classList.remove('active-line');
    }
    
    // Add highlighting to the current line
    const currentLine = codeContent.querySelector(`[data-line-number="${lineNumber}"]`);
    if (currentLine) {
        currentLine.classList.add('active-line');
        // Scroll into view if needed
        currentLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Make highlightCodeLine available globally for viewer.js
window.highlightCodeLine = highlightCodeLine;

// Update file info
function updateFileInfo(data) {
    const fileInfo = document.getElementById('fileInfo');
    const lines = data.content.split('\n').length;
    const size = formatFileSize(data.size);
    
    let info = `${lines} lijnen | ${size} | Laatst gewijzigd: ${new Date(data.modified).toLocaleString('nl-NL')}`;
    
    if (data.parameters) {
        info += ` | Deur: ${data.parameters.length}×${data.parameters.width}×${data.parameters.thickness}mm`;
    }
    
    fileInfo.innerHTML = info;
}

// Display door parameters
function displayDoorParameters(params) {
    console.log('Displaying door parameters:', params);
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo && params) {
        const existingContent = fileInfo.innerHTML;
        if (!existingContent.includes('Deur:')) {
            fileInfo.innerHTML = existingContent + ` | 🚪 Deur: ${params.length}×${params.width}×${params.thickness}mm`;
        }
    }
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Update breadcrumb navigation
function updateBreadcrumb(path) {
    const breadcrumb = document.getElementById('breadcrumb');
    
    if (!path) {
        breadcrumb.innerHTML = '<span data-path="">Root</span>';
        return;
    }
    
    const parts = path.split('\\').filter(p => p);
    let html = '<span data-path="">Root</span>';
    
    let currentPath = '';
    parts.forEach((part, index) => {
        currentPath += (currentPath ? '\\' : '') + part;
        html += '<span class="separator">›</span>';
        html += `<span data-path="${currentPath}">${part}</span>`;
    });
    
    breadcrumb.innerHTML = html;
    
    // Add click handlers to breadcrumb items
    breadcrumb.querySelectorAll('span[data-path]').forEach(span => {
        span.addEventListener('click', () => {
            loadDirectory(span.dataset.path);
        });
    });
}

// Filter files based on search input
function filterFiles(searchTerm) {
    const fileTree = document.getElementById('fileTree');
    const items = fileTree.querySelectorAll('.file-tree-item');
    
    searchTerm = searchTerm.toLowerCase();
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Download current file
function downloadCurrentFile() {
    if (!currentFile) return;
    
    const blob = new Blob([currentFile.content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Copy code to clipboard
async function copyCodeToClipboard() {
    if (!currentFile) return;
    
    try {
        await navigator.clipboard.writeText(currentFile.content);
        
        // Visual feedback
        const copyBtn = document.getElementById('copyBtn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Gekopieerd!';
        copyBtn.style.backgroundColor = '#27ae60';
        
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.backgroundColor = '';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
        alert('Kopiëren mislukt');
    }
}

// Clear code viewer
function clearCodeViewer() {
    const codeContent = document.getElementById('codeContent');
    const fileName = document.getElementById('fileName');
    const fileInfo = document.getElementById('fileInfo');
    const downloadBtn = document.getElementById('downloadBtn');
    const copyBtn = document.getElementById('copyBtn');
    const visualizeBtn = document.getElementById('visualizeBtn');
    
    codeContent.innerHTML = '<code>Selecteer een CNC programma uit de lijst om de code te bekijken...</code>';
    fileName.textContent = 'Selecteer een bestand';
    fileInfo.innerHTML = '';
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    visualizeBtn.disabled = true;
    currentFile = null;
}

// Visualize current file
function visualizeCurrentFile() {
    if (!currentFile) return;
    
    console.log('Visualizing file with parameters:', currentFile.parameters);
    
    // Hide placeholder
    const placeholder = document.querySelector('.viewer-placeholder');
    if (placeholder) {
        placeholder.style.display = 'none';
    }
    
    // Initialize viewer if needed
    if (!cncViewer) {
        initViewer();
    }
    
    // Visualize the G-code with parameters if available
    visualizeGCode(currentFile.content, currentFile.parameters);
    
    // Populate tool switch selector after a short delay to ensure animation steps are ready
    setTimeout(() => {
        populateToolSwitchSelector();
    }, 100);
}

// Populate the tool switch selector
function populateToolSwitchSelector() {
    const toolSwitchSelect = document.getElementById('toolSwitchSelect');
    if (!toolSwitchSelect || !cncViewer || !cncViewer.animationSteps) return;
    
    // Clear existing options
    toolSwitchSelect.innerHTML = '<option value="">-- Selecteer tool wissel --</option>';
    
    // Track previous tool to detect actual changes
    let previousPL = null;
    let previousD = null;
    
    // Find all tool change steps where the tool actually changes
    cncViewer.animationSteps.forEach((step, index) => {
        if (step.command === 'TOOL_CHANGE' || step.command === 'OFFSET_CHANGE') {
            // Skip D0 (no compensation)
            if (step.d === 0) {
                previousD = 0;
                return;
            }
            
            // Only add if PL or D actually changed
            const plChanged = step.pl !== previousPL;
            const dChanged = step.d !== previousD;
            
            if (plChanged || dChanged) {
                const option = document.createElement('option');
                option.value = index;
                
                // Create description
                let description = '';
                if (step.command === 'TOOL_CHANGE') {
                    description = step.tool 
                        ? `T${step.pl} D${step.d}: ${step.tool.name}`
                        : `T${step.pl} D${step.d}`;
                } else if (step.command === 'OFFSET_CHANGE') {
                    description = step.tool 
                        ? `D${step.d}: ${step.tool.name}`
                        : `D${step.d}`;
                }
                
                option.textContent = `Regel ${step.lineNumber}: ${description}`;
                toolSwitchSelect.appendChild(option);
                
                // Update previous values
                previousPL = step.pl;
                previousD = step.d;
            }
        }
    });
    
    console.log(`[populateToolSwitchSelector] Added ${toolSwitchSelect.options.length - 1} tool switches to selector`);
}

// Machine Variables Management
function loadSettingsUI() {
    // Load safe Z position
    const safeZInput = document.getElementById('safeZInput');
    const savedSafeZ = localStorage.getItem('safeToolChangeZ') || '450';
    if (safeZInput) {
        safeZInput.value = savedSafeZ;
        
        // Add event listener to save changes
        safeZInput.removeEventListener('change', saveSafeZ); // Remove old listener
        safeZInput.addEventListener('change', saveSafeZ);
    }
    
    // Load max rapid feedrate
    const maxRapidFeedInput = document.getElementById('maxRapidFeedInput');
    const savedMaxRapidFeed = localStorage.getItem('maxRapidFeedrate') || '50000';
    if (maxRapidFeedInput) {
        maxRapidFeedInput.value = savedMaxRapidFeed;
        
        // Add event listener to save changes
        maxRapidFeedInput.removeEventListener('change', saveMaxRapidFeed);
        maxRapidFeedInput.addEventListener('change', saveMaxRapidFeed);
    }
    
    // Load variables table
    renderVariablesTable();
}

function saveSafeZ(e) {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        localStorage.setItem('safeToolChangeZ', value);
        console.log(`Safe tool change Z position set to: ${value}`);
    }
}

function saveMaxRapidFeed(e) {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value > 0) {
        localStorage.setItem('maxRapidFeedrate', value);
        console.log(`Max rapid feedrate set to: ${value} mm/min`);
    }
}

function getMachineVariables() {
    const saved = localStorage.getItem('machineVariables');
    return saved ? JSON.parse(saved) : {};
}

function saveMachineVariables(variables) {
    localStorage.setItem('machineVariables', JSON.stringify(variables));
}

function renderVariablesTable() {
    const tbody = document.getElementById('variablesTableBody');
    const variables = getMachineVariables();
    
    tbody.innerHTML = '';
    
    Object.entries(variables).forEach(([name, value]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding: 0.5rem; border: 1px solid #444;">
                <input type="text" value="${name}" data-old-name="${name}" class="var-name" 
                    style="width: 100%; background: #2d2d2d; border: 1px solid #555; color: #fff; padding: 0.25rem;">
            </td>
            <td style="padding: 0.5rem; border: 1px solid #444;">
                <input type="text" value="${value}" data-var-name="${name}" class="var-value"
                    style="width: 100%; background: #2d2d2d; border: 1px solid #555; color: #fff; padding: 0.25rem;">
            </td>
            <td style="padding: 0.5rem; border: 1px solid #444; text-align: center;">
                <button class="btn btn-small btn-danger delete-var" data-var-name="${name}" style="padding: 0.25rem 0.5rem;">🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Add event listeners
    tbody.querySelectorAll('.var-name').forEach(input => {
        input.addEventListener('change', handleVariableNameChange);
    });
    
    tbody.querySelectorAll('.var-value').forEach(input => {
        input.addEventListener('change', handleVariableValueChange);
    });
    
    tbody.querySelectorAll('.delete-var').forEach(btn => {
        btn.addEventListener('click', () => {
            const varName = btn.dataset.varName;
            deleteVariable(varName);
        });
    });
}

function handleVariableNameChange(e) {
    const oldName = e.target.dataset.oldName;
    const newName = e.target.value.trim();
    
    if (!newName || newName === oldName) return;
    
    const variables = getMachineVariables();
    
    // Check if new name already exists
    if (variables[newName] && newName !== oldName) {
        alert('Deze variabele naam bestaat al!');
        e.target.value = oldName;
        return;
    }
    
    // Rename variable
    variables[newName] = variables[oldName];
    delete variables[oldName];
    
    saveMachineVariables(variables);
    renderVariablesTable();
}

function handleVariableValueChange(e) {
    const varName = e.target.dataset.varName;
    const newValue = e.target.value.trim();
    
    const variables = getMachineVariables();
    variables[varName] = newValue;
    
    saveMachineVariables(variables);
}

function addMachineVariable() {
    const variables = getMachineVariables();
    
    // Find unique name
    let counter = 1;
    let newName = '$MA_VARIABLE';
    while (variables[newName]) {
        newName = `$MA_VARIABLE_${counter}`;
        counter++;
    }
    
    variables[newName] = '0';
    saveMachineVariables(variables);
    renderVariablesTable();
}

function deleteVariable(name) {
    if (!confirm(`Weet je zeker dat je variabele "${name}" wilt verwijderen?`)) return;
    
    const variables = getMachineVariables();
    delete variables[name];
    saveMachineVariables(variables);
    renderVariablesTable();
}

// Export function to resolve variable values in G-code
export function resolveMachineVariable(varName) {
    const variables = getMachineVariables();
    return variables[varName] || null;
}
