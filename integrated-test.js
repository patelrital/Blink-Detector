const CalibratedFlickerDetector = require('./CalibratedFlickerDetector');
const BlinkCameraController = require('./BlinkCameraController');
const fs = require('fs');
const path = require('path');
const os = require('os');

class IntegratedBlinkTest {
    constructor() {
        this.flickerDetector = new CalibratedFlickerDetector();
        this.cameraController = new BlinkCameraController();
        this.isRunning = false;
        this.testDuration = 90000;
        this.blinkCount = 0;
        this.logDir = path.join(os.homedir(), 'BlinkLogs');
        this.currentLogFile = null;
        
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
    }

    initializeLogFile() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.currentLogFile = path.join(this.logDir, `blink_log_${timestamp}.csv`);
        
        // Create CSV header
        fs.writeFileSync(this.currentLogFile, 'Timestamp,Sensor,Value\n');
        
        this.log(`Logging blinks to: ${this.currentLogFile}`);
        return this.currentLogFile;
    }

    logBlink(sensorIndex, value) {
        if (this.currentLogFile) {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(this.currentLogFile, `${timestamp},${sensorIndex + 1},${value}\n`);
        }
    }

    async initialize() {
        try {
            await this.flickerDetector.initialize();
            await this.cameraController.initialize();
            
            this.log('System initialized successfully');
            console.log('\n=== Recording Started ===');
            console.log('Monitoring for blinks...\n');
            
            // Initialize log file
            this.initializeLogFile();
            
            return true;
        } catch (error) {
            this.log(`Initialization error: ${error.message}`);
            throw error;
        }
    }

    async startTest() {
        this.isRunning = true;
        const startTime = Date.now();
        
        try {
            await this.cameraController.startContinuousRecording();
            
            while (this.isRunning && (Date.now() - startTime) < this.testDuration) {
                try {
                    const reading = await this.flickerDetector.device.ReadSensor();
                    const changes = this.flickerDetector.detectStateChange(reading.value1, reading.value2);
                    
                    for (let i = 0; i < 2; i++) {
                        if (changes[i]) {
                            if (this.flickerDetector.isOn[i] && !this.flickerDetector.wasOn[i]) {
                                this.blinkCount++;
                                this.log(`BLINK DETECTED (#${this.blinkCount}) on Sensor ${i + 1}`);
                                this.logBlink(i, i === 0 ? reading.value1 : reading.value2);
                                this.cameraController.handleBlinkDetected();
                            }
                            this.flickerDetector.wasOn[i] = this.flickerDetector.isOn[i];
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, 10));

                } catch (error) {
                    if (error.message.includes('Serial port error')) {
                        this.log('Serial port error - attempting recovery...');
                        await this.flickerDetector.device.initialize();
                    }
                }
            }

            this.log('\nTest Summary:');
            this.log(`Total blinks detected: ${this.blinkCount}`);
            
        } catch (error) {
            this.log(`Test error: ${error.message}`);
            throw error;
        }
    }

    async cleanup() {
        this.isRunning = false;
        this.log('Stopping recording and cleaning up...');
        
        try {
            await this.cameraController.cleanup();
            await this.flickerDetector.cleanup();
            this.log('Cleanup completed successfully');
            return this.currentLogFile;
        } catch (error) {
            this.log(`Error during cleanup: ${error.message}`);
            throw error;
        }
    }

    getLogDirectory() {
        return this.logDir;
    }
}

module.exports = IntegratedBlinkTest;