// CalibratedFlickerDetector.js
const DeviceSerialPort = require('./serialport');
const readline = require('readline');

// Static calibration values storage
let savedCalibration = {
    whiteValue: [null, null],
    blackValue: [null, null],
    threshold: [null, null]
};

class CalibratedFlickerDetector {
    constructor() {
        this.device = new DeviceSerialPort();
        this.isOn = [false, false];  // Status for both sensors
        this.wasOn = [false, false]; // Previous status for both sensors
        this.lastValue = [null, null];
        this.threshold = [null, null];  // Thresholds for both sensors
        this.blinkCount = [0, 0];    // Separate blink counts for each sensor
        
        // Calibration values for both sensors
        this.whiteValue = [null, null];
        this.blackValue = [null, null];
    }

    createInterface() {
        return readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async initialize() {
        console.log('Initializing flicker detector...');
        await this.device.initialize();
        console.log('✓ Connected to port:', this.device.portPath);
        
        // Check for saved calibration values
        if (this.hasSavedCalibration()) {
            console.log('Found saved calibration values...');
            await this.loadCalibration();
        } else {
            // Run calibration for both sensors
            await this.calibrate();
        }
    }

    hasSavedCalibration() {
        return savedCalibration.whiteValue[0] !== null && 
               savedCalibration.blackValue[0] !== null &&
               savedCalibration.whiteValue[1] !== null && 
               savedCalibration.blackValue[1] !== null;
    }

    async loadCalibration() {
        console.log('\nLoading saved calibration values...');
        
        this.whiteValue = [...savedCalibration.whiteValue];
        this.blackValue = [...savedCalibration.blackValue];
        this.threshold = [...savedCalibration.threshold];

        console.log('\nSensor 1 Calibration:');
        console.log(`White Level: ${this.whiteValue[0].toFixed(3)}`);
        console.log(`Black Level: ${this.blackValue[0].toFixed(3)}`);
        console.log(`Threshold: ${this.threshold[0].toFixed(3)}`);

        console.log('\nSensor 2 Calibration:');
        console.log(`White Level: ${this.whiteValue[1].toFixed(3)}`);
        console.log(`Black Level: ${this.blackValue[1].toFixed(3)}`);
        console.log(`Threshold: ${this.threshold[1].toFixed(3)}`);

        // Verify saved calibration with a quick test reading
        try {
            const reading = await this.device.ReadSensor();
            console.log('\nCalibration verification reading:', reading);
            console.log('✓ Saved calibration loaded successfully');
        } catch (error) {
            console.log('Error verifying calibration:', error.message);
            console.log('Proceeding with new calibration...');
            savedCalibration = {
                whiteValue: [null, null],
                blackValue: [null, null],
                threshold: [null, null]
            };
            await this.calibrate();
        }
    }

    saveCalibration() {
        savedCalibration = {
            whiteValue: [...this.whiteValue],
            blackValue: [...this.blackValue],
            threshold: [...this.threshold]
        };
        console.log('Calibration values saved for future use');
    }

    async calibrate() {
        console.log('\nStarting Calibration Process');
        console.log('==========================');
        
        const rl = this.createInterface();
        
        try {
            // Calibrate Sensor 1
            console.log('\nCalibrating Sensor 1...');
            this.whiteValue[0] = await this.calibrateScreen(rl, 'WHITE', 0);
            console.log(`Sensor 1 White screen value: ${this.whiteValue[0]}`);

            this.blackValue[0] = await this.calibrateScreen(rl, 'BLACK', 0);
            console.log(`Sensor 1 Black screen value: ${this.blackValue[0]}`);

            const range1 = Math.abs(this.whiteValue[0] - this.blackValue[0]);
            this.threshold[0] = range1 * 0.5;

            console.log('\nSensor 1 Calibration Results:');
            console.log(`White Level: ${this.whiteValue[0].toFixed(3)}`);
            console.log(`Black Level: ${this.blackValue[0].toFixed(3)}`);
            console.log(`Calculated Threshold: ${this.threshold[0].toFixed(3)}`);

            await new Promise(resolve => {
                rl.question('\nPress Enter to begin calibrating Sensor 2...', resolve);
            });

            // Calibrate Sensor 2
            console.log('\nCalibrating Sensor 2...');
            this.whiteValue[1] = await this.calibrateScreen(rl, 'WHITE', 1);
            console.log(`Sensor 2 White screen value: ${this.whiteValue[1]}`);

            this.blackValue[1] = await this.calibrateScreen(rl, 'BLACK', 1);
            console.log(`Sensor 2 Black screen value: ${this.blackValue[1]}`);

            const range2 = Math.abs(this.whiteValue[1] - this.blackValue[1]);
            this.threshold[1] = range2 * 0.5;

            console.log('\nSensor 2 Calibration Results:');
            console.log(`White Level: ${this.whiteValue[1].toFixed(3)}`);
            console.log(`Black Level: ${this.blackValue[1].toFixed(3)}`);
            console.log(`Calculated Threshold: ${this.threshold[1].toFixed(3)}`);
            
            // Save the calibration values
            this.saveCalibration();
            
            return true;
        } catch (error) {
            console.error('Calibration failed:', error.message);
            throw error;
        } finally {
            rl.close();
        }
    }

    async calibrateScreen(rl, screenType, sensorIndex) {
        console.log(`\nPlease show a ${screenType} screen for Sensor ${sensorIndex + 1}`);
        
        await new Promise(resolve => {
            rl.question(`Press Enter when showing ${screenType} screen for Sensor ${sensorIndex + 1}...`, resolve);
        });

        console.log(`Sampling ${screenType} screen values for Sensor ${sensorIndex + 1}...`);
        const samples = [];
        const numSamples = 10;
        
        for (let i = 0; i < numSamples; i++) {
            try {
                const reading = await this.device.ReadSensor();
                samples.push(sensorIndex === 0 ? reading.value1 : reading.value2);
                process.stdout.write('.');
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`\nError reading sensor: ${error.message}`);
                throw error;
            }
        }
        console.log('\n');

        const average = samples.reduce((a, b) => a + b, 0) / samples.length;
        
        const stdDev = Math.sqrt(
            samples.reduce((sq, n) => sq + Math.pow(n - average, 2), 0) / (samples.length - 1)
        );
        
        if (stdDev > 0.1 * average) {
            console.warn(`Warning: High variance in ${screenType} readings for Sensor ${sensorIndex + 1} (SD: ${stdDev.toFixed(3)})`);
            console.warn('Consider recalibrating if detection is unreliable');
        }

        return average;
    }

    detectStateChange(currentValue1, currentValue2) {
        const changes = [false, false];

        // Process Sensor 1
        if (this.lastValue[0] === null) {
            this.lastValue[0] = currentValue1;
        } else {
            const change1 = Math.abs(currentValue1 - this.lastValue[0]);
            this.lastValue[0] = currentValue1;
            this.isOn[0] = change1 >= this.threshold[0];
            changes[0] = true;
        }

        // Process Sensor 2
        if (this.lastValue[1] === null) {
            this.lastValue[1] = currentValue2;
        } else {
            const change2 = Math.abs(currentValue2 - this.lastValue[1]);
            this.lastValue[1] = currentValue2;
            this.isOn[1] = change2 >= this.threshold[1];
            changes[1] = true;
        }

        return changes;
    }

    logBlink(sensorIndex) {
        this.blinkCount[sensorIndex]++;
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Blink detected on Sensor ${sensorIndex + 1}! (Sensor ${sensorIndex + 1} total blinks: ${this.blinkCount[sensorIndex]})`);
    }

    async cleanup() {
        console.log('\nCleaning up...');
        await this.device.close();
        console.log('✓ Device closed successfully');
    }

    // Static method to clear saved calibration if needed
    static clearSavedCalibration() {
        savedCalibration = {
            whiteValue: [null, null],
            blackValue: [null, null],
            threshold: [null, null]
        };
        console.log('Cleared saved calibration values');
    }

    // Method to force recalibration
    async recalibrate() {
        CalibratedFlickerDetector.clearSavedCalibration();
        await this.calibrate();
    }
}

module.exports = CalibratedFlickerDetector;