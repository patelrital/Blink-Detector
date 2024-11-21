const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class BlinkCameraController extends EventEmitter {
    constructor() {
        super();
        this.outputDir = path.join(os.homedir(), 'BlinkVideos');
        this.cameraName = 'Lenovo Performance RGB Camera';
        this.bufferProcess = null;
        this.segmentsWithBlinks = new Set();
        this.currentSegment = null;
        this.videoQueue = [];
        this.cleanupInterval = null;
        this.segmentDuration = 30; // Duration in seconds
        this.retentionWindow = 2; // Number of segments to keep before cleanup
    }

    // Ensure the output directory exists
    async ensureOutputDirectory() {
        try {
            if (!fs.existsSync(this.outputDir)) {
                this.log(`Creating videos directory: ${this.outputDir}`);
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            this.log(`Videos directory confirmed: ${this.outputDir}`);
            await this.cleanOutputDirectory();
            return true;
        } catch (error) {
            this.log(`Error creating directory: ${error.message}`);
            throw new Error(`Failed to create videos directory: ${error.message}`);
        }
    }

    // Clean output directory of existing MP4 files
    async cleanOutputDirectory() {
        try {
            const files = fs.readdirSync(this.outputDir);
            for (const file of files) {
                if (file.endsWith('.mp4')) {
                    fs.unlinkSync(path.join(this.outputDir, file));
                }
            }
            this.log('Cleaned output directory');
        } catch (error) {
            this.log(`Error cleaning directory: ${error.message}`);
            throw error;
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
    }

    async initialize() {
        this.log('Initializing camera controller...');
        
        // First ensure the output directory exists
        await this.ensureOutputDirectory();
        
        this.log('Testing camera access...');
        try {
            // First, check if FFmpeg is installed
            const versionCheck = spawn('ffmpeg', ['-version']);
            await new Promise((resolve, reject) => {
                versionCheck.on('error', (err) => {
                    if (err.code === 'ENOENT') {
                        reject(new Error(
                            'FFmpeg is not installed or not in PATH. ' +
                            'Please install FFmpeg and add it to your system PATH. ' +
                            'Visit https://ffmpeg.org/download.html for installation instructions.'
                        ));
                    } else {
                        reject(err);
                    }
                });
                versionCheck.on('exit', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`FFmpeg check failed with code ${code}`));
                });
            });
            
            this.log('FFmpeg installation verified');

            // Now test camera access
            const testProcess = spawn('ffmpeg', [
                '-f', 'dshow',
                '-video_size', '640x480',
                '-i', `video=${this.cameraName}`,
                '-frames:v', '1',
                '-f', 'null',
                '-'
            ]);

            await new Promise((resolve, reject) => {
                let errorOutput = '';
                
                testProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    errorOutput += output;
                    if (output.includes('Input #0')) {
                        resolve();
                    }
                });

                testProcess.on('error', (err) => {
                    reject(new Error(`Camera test failed: ${err.message}`));
                });

                testProcess.on('exit', (code) => {
                    if (code !== 0 && !errorOutput.includes('Input #0')) {
                        reject(new Error(`Camera test failed. FFmpeg output: ${errorOutput}`));
                    }
                });

                setTimeout(() => reject(new Error('Camera timeout - No response from camera')), 2000);
            });
            
            this.log('Camera test successful');
            return true;
        } catch (error) {
            this.log('Camera initialization failed: ' + error.message);
            throw error;
        }
    }

    startContinuousRecording() {
        this.log('Starting continuous recording...');
        
        // Verify directory exists before starting recording
        if (!fs.existsSync(this.outputDir)) {
            this.log('Output directory missing, creating...');
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        const outputPattern = path.join(this.outputDir, `segment_%03d_${timestamp}.mp4`);
        
        this.log(`Output pattern: ${outputPattern}`);
        
        const args = [
            '-f', 'dshow',
            '-rtbufsize', '1024M',
            '-framerate', '30',
            '-video_size', '640x480',
            '-i', `video=${this.cameraName}`,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-movflags', '+faststart',
            '-f', 'segment',
            '-segment_time', '30',
            '-segment_format', 'mp4',
            '-segment_format_options', 'movflags=+faststart',
            '-reset_timestamps', '1',
            outputPattern
        ];

        this.bufferProcess = spawn('ffmpeg', args);

        this.bufferProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Error') || output.includes('error')) {
                this.log(`FFmpeg Error: ${output}`);
            }
            if (output.includes('Opening')) {
                const match = output.match(/Opening '(.+)' for writing/);
                if (match) {
                    const previousSegment = this.currentSegment;
                    this.currentSegment = match[1];
                    
                    if (previousSegment) {
                        this.videoQueue.push({
                            path: previousSegment,
                            timestamp: Date.now()
                        });
                        this.performCleanup();
                    }
                }
            }
        });

        this.bufferProcess.on('exit', (code) => {
            this.log(`FFmpeg process exited with code ${code}`);
        });

        this.cleanupInterval = setInterval(() => this.performCleanup(), 
            (this.segmentDuration * 1000) / 2);

        this.log('Recording started successfully');
    }

    handleBlinkDetected() {
        if (this.currentSegment) {
            this.segmentsWithBlinks.add(this.currentSegment);
            this.log(`BLINK DETECTED! Adding ${path.basename(this.currentSegment)} to save list`);
        }
    }

    async processVideos() {
        this.log('\nProcessing videos...');
        
        const files = fs.readdirSync(this.outputDir);
        let savedCount = 0;
        let deletedCount = 0;

        for (const file of files) {
            if (!file.endsWith('.mp4')) continue;
            
            const filePath = path.join(this.outputDir, file);
            
            // Check if this segment had any blinks
            const shouldSave = Array.from(this.segmentsWithBlinks).some(segment => 
                path.basename(segment) === file
            );

            try {
                if (shouldSave) {
                    // Rename with blink_ prefix
                    const newName = 'blink_' + file;
                    const newPath = path.join(this.outputDir, newName);
                    fs.renameSync(filePath, newPath);
                    this.log(`Saved video with blink: ${newName}`);
                    savedCount++;
                } else {
                    // Delete segments with no blinks
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (error) {
                this.log(`Error processing ${file}: ${error.message}`);
            }
        }

        this.log(`\nProcessing complete!`);
        this.log(`Videos saved: ${savedCount}`);
        this.log(`Videos deleted: ${deletedCount}`);
        this.log(`Save location: ${this.outputDir}`);
    }

    async stopRecording() {
        this.log('Stopping recording...');
        
        if (this.bufferProcess) {
            // Send quit command to FFmpeg
            this.bufferProcess.stdin.write('q');
            
            // Force kill after timeout if needed
            const killTimeout = setTimeout(() => {
                this.log('Force killing FFmpeg process...');
                this.bufferProcess.kill('SIGKILL');
            }, 2000);
            
            // Wait for process to exit
            await new Promise(resolve => {
                this.bufferProcess.on('exit', () => {
                    clearTimeout(killTimeout);
                    resolve();
                });
            });
            
            this.bufferProcess = null;
            this.log('Recording stopped');
            
            // Wait a moment for file operations to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Process the videos
            await this.processVideos();
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Process remaining videos
        while (this.videoQueue.length > 0) {
            await this.performCleanup();
        }
    }

    async cleanup() {
        this.log('Starting cleanup...');
        await this.stopRecording();
        this.log('Cleanup complete');
    }

    performCleanup() {
        const now = Date.now();
        const retentionPeriod = this.segmentDuration * 1000 * this.retentionWindow;

        while (this.videoQueue.length > 0 && 
               (now - this.videoQueue[0].timestamp) > retentionPeriod) {
            const segment = this.videoQueue.shift();
            // Only delete if not marked for saving
            if (segment && !this.segmentsWithBlinks.has(segment.path)) {
                try {
                    fs.unlinkSync(segment.path);
                    this.log(`Cleaned up segment: ${path.basename(segment.path)}`);
                } catch (error) {
                    this.log(`Error cleaning up segment: ${error.message}`);
                }
            }
        }
    }
}

module.exports = BlinkCameraController;