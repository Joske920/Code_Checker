from flask import Flask, jsonify, send_from_directory, request, send_file
from flask_cors import CORS
import os
from pathlib import Path
from datetime import datetime
import subprocess
import tempfile
import uuid
import shutil

app = Flask(__name__, static_folder='.')
CORS(app)

# Check if FFmpeg is available
def check_ffmpeg():
    """Check if FFmpeg is installed and accessible"""
    return shutil.which('ffmpeg') is not None

# CNC bestanden directory
#CNC_ROOT = r'E:\Theuma_pro\cnc'
#CNC_ROOT = r'C:\E_DRIVE_COPY\CNC'
#CNC_ROOT = r'Z:\\'
CNC_ROOT = r'/home/joske/workspace/Joske920.git/E_DRIVE_COPY/'

# Allowed file extensions for CNC programs
ALLOWED_EXTENSIONS = {'.nc', '.cnc', '.mpf', '.spf', '.txt'}


def is_safe_path(base_path, user_path):
    """Check if the user path is within the base path (security check)"""
    base = Path(base_path).resolve()
    target = (base / user_path).resolve()
    return target.is_relative_to(base)


def get_file_info(file_path):
    """Get file metadata"""
    stat = os.stat(file_path)
    return {
        'size': stat.st_size,
        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
        'created': datetime.fromtimestamp(stat.st_ctime).isoformat()
    }


@app.route('/api/browse')
def browse_directory():
    """Browse CNC directory structure"""
    relative_path = request.args.get('path', '')
    
    # Security check
    if not is_safe_path(CNC_ROOT, relative_path):
        return jsonify({'error': 'Invalid path'}), 403
    
    target_path = os.path.join(CNC_ROOT, relative_path)
    
    if not os.path.exists(target_path):
        return jsonify({'error': 'Path does not exist'}), 404
    
    if not os.path.isdir(target_path):
        return jsonify({'error': 'Not a directory'}), 400
    
    items = []
    
    try:
        with os.scandir(target_path) as entries:
            for entry in entries:
                relative_item_path = os.path.join(relative_path, entry.name) if relative_path else entry.name
                
                # Always add directories
                if entry.is_dir(follow_symlinks=False):
                    stat_info = entry.stat(follow_symlinks=False)
                    items.append({
                        'name': entry.name,
                        'type': 'folder',
                        'path': relative_item_path,
                        'modified': stat_info.st_mtime
                    })
                # Only check files
                elif entry.is_file(follow_symlinks=False):
                    # Check if file has allowed extension
                    file_ext = os.path.splitext(entry.name)[1].lower()
                    if file_ext in ALLOWED_EXTENSIONS or file_ext == '':
                        stat_info = entry.stat(follow_symlinks=False)
                        items.append({
                            'name': entry.name,
                            'type': 'file',
                            'path': relative_item_path,
                            'modified': stat_info.st_mtime
                        })
        
        # Sorteer items op modificatiedatum (nieuwste eerst)
        items.sort(key=lambda x: x['modified'], reverse=True)
        
        # Verwijder de modified timestamp uit de response (niet nodig in frontend)
        for item in items:
            del item['modified']
            
    except PermissionError:
        return jsonify({'error': 'Permission denied'}), 403
    except Exception as e:
        return jsonify({'error': f'Error reading directory: {str(e)}'}), 500
    
    # Determine parent path
    parent_path = None
    if relative_path:
        parent_path = str(Path(relative_path).parent)
        if parent_path == '.':
            parent_path = ''
    
    return jsonify({
        'current_path': relative_path,
        'parent_path': parent_path,
        'items': items
    })


def is_safe_path(base_path, user_path):
    """Check if the user path is within the base path (security check)"""
    base = Path(base_path).resolve()
    target = (base / user_path).resolve()
    return target.is_relative_to(base)


def get_file_info(file_path):
    """Get file metadata"""
    stat = os.stat(file_path)
    return {
        'size': stat.st_size,
        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
        'created': datetime.fromtimestamp(stat.st_ctime).isoformat()
    }


# Removed is_text_file function - now only using file extensions for filtering


@app.route('/api/file')
def get_file():
    """Get file content"""
    relative_path = request.args.get('path', '')
    
    # Security check
    if not is_safe_path(CNC_ROOT, relative_path):
        return jsonify({'error': 'Invalid path'}), 403
    
    file_path = os.path.join(CNC_ROOT, relative_path)
    
    if not os.path.exists(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    if not os.path.isfile(file_path):
        return jsonify({'error': 'Not a file'}), 400
    
    try:
        # Try UTF-8 first
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except UnicodeDecodeError:
            # Fallback to latin-1
            with open(file_path, 'r', encoding='latin-1') as f:
                content = f.read()
        
        file_info = get_file_info(file_path)
        
        result = {
            'content': content,
            'size': file_info['size'],
            'modified': file_info['modified'],
            'created': file_info['created']
        }
        
        # If this is a K1 file, try to find and parse the K3 parameter file
        if '_K1' in os.path.basename(file_path):
            k3_path = file_path.replace('_K1', '_K3')
            if os.path.exists(k3_path):
                try:
                    with open(k3_path, 'r', encoding='utf-8') as f:
                        k3_content = f.read()
                    result['parameters'] = parse_k3_parameters(k3_content)
                except:
                    pass
        
        return jsonify(result)
    
    except PermissionError:
        return jsonify({'error': 'Permission denied'}), 403
    except Exception as e:
        return jsonify({'error': f'Error reading file: {str(e)}'}), 500


def parse_k3_parameters(content):
    """Parse K3 parameter file for door dimensions"""
    params = {}
    lines = content.split('\n')
    
    for line in lines:
        line = line.strip()
        # Look for RFID_APP parameters
        if 'RFID_APP_DOORLENGTH[0]=' in line:
            try:
                params['length'] = float(line.split('=')[1])
            except:
                pass
        elif 'RFID_APP_DOORWIDTH[0]=' in line:
            try:
                params['width'] = float(line.split('=')[1])
            except:
                pass
        elif 'RFID_APP_DOORTHICKNESS[0]=' in line:
            try:
                params['thickness'] = float(line.split('=')[1])
            except:
                pass
        elif 'RFID_APP_FOLD_ABOVE[0]=' in line:
            try:
                params['fold_above'] = float(line.split('=')[1])
            except:
                pass
        elif 'RFID_APP_FOLD_LEFT[0]=' in line:
            try:
                params['fold_right'] = float(line.split('=')[1])
            except:
                pass
        elif 'RFID_APP_FOLD_RIGHT[0]=' in line:
            try:
                params['fold_left'] = float(line.split('=')[1])
            except:
                pass
    
    return params if params else None


@app.route('/api/search')
def search_files():
    """Search for files by name"""
    query = request.args.get('q', '').lower()
    
    if not query:
        return jsonify({'results': []})
    
    results = []
    
    try:
        # Use os.scandir recursively - more efficient than os.walk
        def scan_directory(path, base_path):
            if len(results) >= 50:
                return
                
            try:
                with os.scandir(path) as entries:
                    for entry in entries:
                        if len(results) >= 50:
                            break
                            
                        if entry.is_file(follow_symlinks=False):
                            if query in entry.name.lower():
                                file_ext = os.path.splitext(entry.name)[1].lower()
                                if file_ext in ALLOWED_EXTENSIONS or file_ext == '':
                                    relative_path = os.path.relpath(entry.path, base_path)
                                    results.append({
                                        'name': entry.name,
                                        'path': relative_path,
                                        'folder': os.path.dirname(relative_path)
                                    })
                        elif entry.is_dir(follow_symlinks=False):
                            scan_directory(entry.path, base_path)
            except PermissionError:
                pass  # Skip directories we can't access
        
        scan_directory(CNC_ROOT, CNC_ROOT)
    
    except Exception as e:
        return jsonify({'error': f'Search error: {str(e)}'}), 500
    
    return jsonify({'results': results})


@app.route('/')
def index():
    """Serve the main HTML page"""
    return send_from_directory('.', 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files (CSS, JS)"""
    return send_from_directory('.', filename)


@app.route('/api/check-ffmpeg')
def check_ffmpeg_endpoint():
    """Check if FFmpeg is available"""
    return jsonify({
        'available': check_ffmpeg()
    })


@app.route('/api/convert-video', methods=['POST'])
def convert_video():
    """Convert WebM video to requested format using FFmpeg"""
    try:
        # Check if FFmpeg is available
        if not check_ffmpeg():
            return jsonify({
                'error': 'FFmpeg not found',
                'message': 'Installeer FFmpeg via: pip install ffmpeg-python\nOf download van https://ffmpeg.org/download.html'
            }), 500
        
        # Get the format from request
        target_format = request.form.get('format', 'mp4')
        
        # Get the uploaded file
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        input_path = os.path.join(temp_dir, f'input_{uuid.uuid4()}.webm')
        
        # Save uploaded file
        video_file.save(input_path)
        
        # Generate timestamp for output filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Determine output format and FFmpeg parameters
        if target_format == 'mp4':
            output_filename = f'cnc-recording-{timestamp}.mp4'
            output_path = os.path.join(temp_dir, output_filename)
            # Convert to MP4 with H.264 codec
            cmd = [
                'ffmpeg', '-i', input_path,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                '-y',
                output_path
            ]
        elif target_format == 'avi':
            output_filename = f'cnc-recording-{timestamp}.avi'
            output_path = os.path.join(temp_dir, output_filename)
            # Convert to AVI with MJPEG codec
            cmd = [
                'ffmpeg', '-i', input_path,
                '-c:v', 'mjpeg',
                '-q:v', '3',
                '-c:a', 'pcm_s16le',
                '-y',
                output_path
            ]
        elif target_format == 'gif':
            output_filename = f'cnc-recording-{timestamp}.gif'
            output_path = os.path.join(temp_dir, output_filename)
            # Convert to GIF with palette for better quality
            palette_path = os.path.join(temp_dir, 'palette.png')
            # First generate palette
            cmd_palette = [
                'ffmpeg', '-i', input_path,
                '-vf', 'fps=15,scale=640:-1:flags=lanczos,palettegen',
                '-y',
                palette_path
            ]
            subprocess.run(cmd_palette, check=True, capture_output=True)
            
            # Then create GIF using palette
            cmd = [
                'ffmpeg', '-i', input_path, '-i', palette_path,
                '-lavfi', 'fps=15,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse',
                '-y',
                output_path
            ]
        else:
            return jsonify({'error': f'Unsupported format: {target_format}'}), 400
        
        # Run FFmpeg conversion
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        # Send converted file
        response = send_file(
            output_path,
            as_attachment=True,
            download_name=output_filename,
            mimetype='application/octet-stream'
        )
        
        # Clean up temp files after sending
        # Note: Files will be deleted after the response is sent
        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(input_path):
                    os.remove(input_path)
                if os.path.exists(output_path):
                    os.remove(output_path)
                if target_format == 'gif':
                    palette_path_cleanup = os.path.join(temp_dir, 'palette.png')
                    if os.path.exists(palette_path_cleanup):
                        os.remove(palette_path_cleanup)
                os.rmdir(temp_dir)
            except Exception as e:
                print(f"Cleanup error: {e}")
        
        return response
        
    except subprocess.CalledProcessError as e:
        return jsonify({
            'error': 'FFmpeg conversion failed',
            'details': e.stderr
        }), 500
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500


if __name__ == '__main__':
    # Check if CNC directory exists
    if not os.path.exists(CNC_ROOT):
        print(f"WAARSCHUWING: CNC directory niet gevonden: {CNC_ROOT}")
        print("Server start, maar de directory moet gecreëerd worden of het pad moet aangepast worden.")
    else:
        print(f"CNC Root Directory: {CNC_ROOT}")
    
    # Check FFmpeg availability
    if check_ffmpeg():
        print("✓ FFmpeg is beschikbaar - video conversie mogelijk")
    else:
        print("⚠ FFmpeg niet gevonden - video conversie zal niet werken")
        print("  Installeer met: pip install ffmpeg-python")
        print("  Of download van: https://ffmpeg.org/download.html")
    
    print("\nCNC Programma Viewer Server")
    print("=" * 50)
    print(f"Server draait op: http://localhost:5000")
    print("Druk op CTRL+C om te stoppen\n")
    
    app.run(host='0.0.0.0', port=5000, debug=True)
